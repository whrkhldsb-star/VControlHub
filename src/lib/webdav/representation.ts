import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { uploadTmpDir } from "@/lib/runtime/work-dirs";
import { assertUploadDiskReserve } from "@/lib/upload/service";
import { WEBDAV_PUT_STAGING_PREFIX } from "@/lib/upload/staging";
import { localObjectVersion } from "@/lib/storage/local-identity";
import { openManagedLocalFile } from "@/lib/storage/open-local-file";
import { streamStorageFile, type StorageFileNode } from "@/lib/storage/file-content";
import { createRemoteStorageClient } from "@/lib/storage/agent-file-client";

type Range = { start: number; end: number };
type Representation = {
  size: number;
  etag: string;
  backingVersion?: string;
  lastModified?: Date;
  stream: (range?: Range) => Promise<Readable>;
  close: () => Promise<void>;
};
const tag = (version: string) => '"' + createHash("sha256").update(version).digest("hex") + '"';

async function openLocal(file: string, digest?: string, basePath?: string): Promise<Representation> {
  const handle = await (basePath === undefined ? open(file, "r") : openManagedLocalFile(basePath, file)).catch(error => {
    if (error.code === "ENOENT") throw new NotFoundError(t("backend.webdav.fileNotFound"));
    throw error;
  });
  try {
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) throw new ValidationError(t("backend.webdav.fileNotFound"));
    const size = Number(stat.size);
    async function* readRange(range?: Range) {
      const end = range?.end ?? size - 1;
      let position = range?.start ?? 0;
      while (position <= end) {
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, end - position + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
        if (!bytesRead) throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
        position += bytesRead;
        yield chunk.subarray(0, bytesRead);
      }
      const current = await handle.stat({ bigint: true });
      if (current.size !== stat.size || current.mtimeNs !== stat.mtimeNs) {
        throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
      }
    }
    return {
      size,
      backingVersion: digest ? undefined : localObjectVersion(stat),
      lastModified: digest ? undefined : stat.mtime,
      etag: digest ?? tag([stat.dev, stat.ino, stat.size, stat.ctimeNs, stat.mtimeNs].join(":")),
      stream: async range => Readable.from(readRange(range), { objectMode: false }),
      close: () => handle.close(),
    };
  } catch (error) { await handle.close(); throw error; }
}

/** Range metadata, validator and stream refer to one opened file or pinned remote revision. */
export async function openRepresentation(node: StorageFileNode, relativePath: string): Promise<Representation> {
  if (node.driver === "LOCAL") {
    return openLocal(relativePath, undefined, node.basePath);
  }
  if (node.driver === "WEBDAV" || node.driver === "AGENT") {
    const client = createRemoteStorageClient(node);
    const entry = await client.stat(relativePath);
    if (!entry || entry.isDirectory) throw new NotFoundError(t("backend.webdav.fileNotFound"));
    if (entry.etag) {
      const version = entry.etag;
      return { size: entry.size, etag: tag(version), backingVersion: version, lastModified: entry.lastModifiedMs ? new Date(entry.lastModifiedMs) : undefined,
        stream: async range => Readable.fromWeb(await client.stream(relativePath, range, entry.size, version) as import("node:stream/web").ReadableStream),
        close: async () => {},
      };
    }
  }
  // SFTP timestamps are coarse, and some WebDAV servers supply no validator. A private snapshot
  // gives the response a strong content digest and permits ranges without reopening the remote path.
  await mkdir(uploadTmpDir(), { recursive: true, mode: 0o700 });
  const tmp = path.join(uploadTmpDir(), WEBDAV_PUT_STAGING_PREFIX + randomUUID() + ".tmp");
  const source = await streamStorageFile(node, relativePath);
  const hash = createHash("sha256");
  try {
    await assertUploadDiskReserve(source.size);
    let received = 0;
    await pipeline(source.stream as Readable, new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length;
        if (received > source.size) return done(new ConflictError(t("backend.storage.editableFileChangedOnDisk")));
        hash.update(chunk);
        done(null, chunk);
      },
    }), createWriteStream(tmp, { flags: "wx", mode: 0o600 }));
    if (received !== source.size) throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
    const snapshot = await openLocal(tmp, '"' + hash.digest("hex") + '"');
    return { ...snapshot, close: async () => {
      try { await snapshot.close(); } finally { await rm(tmp, { force: true }); }
    } };
  } catch (error) { await rm(tmp, { force: true }); throw error; }
  finally { source.close(); }
}

/** RFC 9110 uses strong comparison for If-Match and weak comparison for If-None-Match. */
export function putConditionsPass(headers: Headers, exists: boolean, etag: string | null) {
  const matches = (value: string, strong: boolean) => {
    if (value.trim() === "*") return exists;
    const tags = value.match(/(?:W\/)?"[^"]*"/g) ?? [];
    return exists && etag !== null && tags.some(candidate => (strong ? candidate : candidate.replace(/^W\//, "")) === etag);
  };
  const match = headers.get("if-match"), none = headers.get("if-none-match");
  return (match === null || matches(match, true)) && (none === null || !matches(none, false));
}
