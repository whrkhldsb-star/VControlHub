import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { pack } from "tar-stream";
import type { SessionPayload } from "@/lib/auth/session";
import { ValidationError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";
import { isStorageStagingPath } from "./staging-paths";
import { assertStorageAccess } from "./access-control";
import { createRemoteStorageClient } from "./agent-file-client";

export async function streamRemoteDriveArchive(
  node: Parameters<typeof createRemoteStorageClient>[0] & { id: string }, directory: string,
  excluded: string[], session: SessionPayload, signal: AbortSignal,
) {
  const client = createRemoteStorageClient(node);
  const root = await client.stat(directory);
  if (!root?.isDirectory) throw new ValidationError(apiCopy("apiCopy.target.is.not.a.directory.b74f7510"));
  const archive = pack();
  const output = new PassThrough();
  const cancel = new AbortController();
  const active = AbortSignal.any([cancel.signal, signal]);
  output.once("close", () => cancel.abort());
  void pipeline(archive, createGzip(), output, { signal: active }).catch(() => {});
  const omitted = new Set(excluded);
  let count = 0;

  async function visit(relativePath: string, name: string, depth: number) {
    active.throwIfAborted();
    if (depth > 64) throw new ValidationError(apiCopy("apiCopy.files.op.depth"));
    await new Promise<void>((resolve, reject) => archive.entry({ name, type: "directory" }, Buffer.alloc(0), err => err ? reject(err) : resolve()));
    for (const entry of await client.list(relativePath)) {
      active.throwIfAborted();
      if (++count > 10000) throw new ValidationError(apiCopy("apiCopy.files.op.entries"));
      if (!entry.name || entry.name === "." || entry.name === ".." || /[\\/\x00]/.test(entry.name) ||
          entry.relativePath !== relativePath + "/" + entry.name) throw new ValidationError(apiCopy("apiCopy.files.op.invalid"));
      const child = name + "/" + entry.name;
      if (omitted.has(child) || isStorageStagingPath(entry.name)) continue;
      const access = await assertStorageAccess({ session, storageNodeId: node.id, relativePath: entry.relativePath, operation: "read" });
      if (!access.allowed) continue;
      if (entry.isDirectory) await visit(entry.relativePath, child, depth + 1);
      else {
        const body = await client.stream(entry.relativePath, undefined, entry.size, entry.etag);
        await pipeline(Readable.fromWeb(body as import("node:stream/web").ReadableStream<Uint8Array>),
          archive.entry({ name: child, size: entry.size, mtime: new Date(entry.lastModifiedMs) }), { signal: active });
      }
    }
  }
  void visit(directory, path.posix.basename(directory), 0)
    .then(() => archive.finalize()).catch(error => archive.destroy(error));
  return output;
}
