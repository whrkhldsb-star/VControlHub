import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { z } from "zod";
import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { callFileAgent, getFileChannel, recordVerifiedFileRead } from "./agent-file-queue";
import { createWebDavClient, type WebDavEntry } from "./webdav-client";
import type { WebDavStorageNode } from "./webdav-credentials";
import { normalizeStorageTargetDirectory } from "./path-utils";

const CHUNK = 1_048_576;
const digest = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const bad = () => new BusinessError(t("backend.fileAgent.invalidResult"));
const row = z.object({
  name: z.string().max(255),
  isDirectory: z.boolean(),
  size: z.number().int().nonnegative(),
  lastModifiedMs: z.number().int(),
  etag: z.string().min(1).max(100),
});
function checkedPath(path: string) {
  const normalized = normalizeStorageTargetDirectory(path);
  if (
    !normalized.ok ||
    normalized.path !== path ||
    path.split("/").some((s) => s.toLowerCase().startsWith(".vch-"))
  )
    throw bad();
  return path;
}
export function createAgentFileClient(nodeId: string, serverId?: string) {
  let channel: ReturnType<typeof getFileChannel> | undefined;
  async function call(op: string, path: string, fields: Record<string, string | boolean | number> = {}) {
    channel ??= getFileChannel(nodeId, serverId);
    return callFileAgent(nodeId, await channel, { op, path: checkedPath(path), ...fields });
  }
  async function stat(path: string): Promise<WebDavEntry | null> {
    try {
      const entry = row.parse((await call("stat", path)).entry);
      return { ...entry, relativePath: path };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  async function stream(
    path: string,
    range?: { start: number; end: number },
    expectedSize?: number,
    etag?: string,
  ) {
    const entry = etag && expectedSize !== undefined ? { etag, size: expectedSize } : await stat(path);
    if (!entry?.etag || (expectedSize !== undefined && entry.size !== expectedSize)) throw bad();
    const version = entry.etag;
    let offset = range?.start ?? 0;
    const end = range?.end ?? entry.size - 1;
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(end) ||
      offset < 0 ||
      end >= entry.size ||
      (range && end < offset)
    )
      throw bad();
    const fullHash = !range ? createHash("sha256") : null;
    async function verifyRead() {
      if (fullHash && (await call("checksum", path, { version })).digest !== fullHash.digest("hex")) throw bad();
      await recordVerifiedFileRead(await channel!);
    }
    let cancelled = false;
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (offset > end) {
          await verifyRead();
          if (!cancelled) controller.close();
          return;
        }
        const length = Math.min(CHUNK, end - offset + 1);
        const data = await call("read", path, { offset, length, version });
        if (cancelled) return;
        if (typeof data.data !== "string") throw bad();
        const bytes = Buffer.from(data.data, "base64");
        if (bytes.length !== length || digest(bytes) !== data.digest) throw bad();
        offset += length;
        fullHash?.update(bytes);
        if (offset > end) await verifyRead();
        if (cancelled) return;
        controller.enqueue(bytes);
        if (offset > end) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
  }
  async function upload(
    path: string,
    size: number,
    checksum: string,
    getBytes: (at: number, length: number) => Promise<Buffer>,
    beforePublish?: () => Promise<void>,
  ) {
    const common = { size, digest: checksum };
    const staging = await call("begin", path, common);
    const at = staging.offset;
    if (typeof at !== "number" || !Number.isSafeInteger(at) || at < 0 || at > size) throw bad();
    let offset = at;
    while (offset < size) {
      const length = Math.min(CHUNK, size - offset);
      const bytes = await getBytes(offset, length);
      if (bytes.length !== length) throw bad();
      const reply = await call("chunk", path, {
        ...common,
        offset,
        chunkDigest: digest(bytes),
        data: bytes.toString("base64"),
      });
      offset += length;
      if (reply.offset !== offset) throw bad();
    }
    await beforePublish?.();
    const published = await call("publish", path, common);
    return published.entry ? row.parse(published.entry).etag : null;
  }
  return {
    stat,
    async matches(path: string, size: number, checksum: string) {
      const entry = await stat(path);
      return !!entry?.etag && !entry.isDirectory && entry.size === size &&
        (await call("checksum", path, { version: entry.etag })).digest === checksum;
    },
    stream,
    async list(path = ""): Promise<WebDavEntry[]> {
      const entries = z
        .array(row)
        .max(8192)
        .parse((await call("list", path)).entries);
      return entries.map((entry) => {
        if (!entry.name || entry.name.includes("/") || checkedPath(entry.name) !== entry.name) throw bad();
        return { ...entry, relativePath: path ? `${path}/${entry.name}` : entry.name };
      });
    },
    async read(path: string, maxBytes = 32 * 1024 * 1024) {
      const entry = await stat(path);
      if (!entry || entry.isDirectory || !Number.isSafeInteger(maxBytes) || entry.size > maxBytes) throw bad();
      return Buffer.from(await new Response(await stream(path, undefined, entry.size, entry.etag)).arrayBuffer());
    },
    async write(path: string, content: string | Buffer) {
      const b = Buffer.from(content);
      await upload(path, b.length, digest(b), async (at, length) => b.subarray(at, at + length));
      return { byteSize: b.length };
    },
    async writeLocal(path: string, source: string, checksum?: string, beforePublish?: () => Promise<void>) {
      const f = await open(source, "r");
      try {
        const { size } = await f.stat();
        if (!checksum) {
          const hash = createHash("sha256");
          for await (const chunk of f.createReadStream({ autoClose: false })) hash.update(chunk);
          checksum = hash.digest("hex");
        }
        return await upload(
          path,
          size,
          checksum,
          async (position, length) => {
            const data = Buffer.allocUnsafe(length);
            let received = 0;
            while (received < length) {
              const { bytesRead } = await f.read(data, received, length - received, position + received);
              if (!bytesRead) throw bad();
              received += bytesRead;
            }
            return data;
          },
          beforePublish,
        );
      } finally {
        await f.close();
      }
    },
    async copyStep(target: string, copyId: string, step: string, source?: string, version?: string) {
      const reply = await call("copy-step", target, { copyId, step, ...(version ? { version } : {}), ...(source ? { destination: checkedPath(source) } : {}) });
      if (typeof reply.offset !== "number" || !Number.isSafeInteger(reply.offset) || reply.offset < 0) throw bad();
      return { offset: reply.offset, version: reply.entry ? row.parse(reply.entry).etag : undefined };
    },
    async mkdir(path: string) {
      await call("mkdir", path);
    },
    async rename(path: string, destination: string, overwrite = false) {
      await call("rename", path, { destination: checkedPath(destination), overwrite });
    },
    async copy(path: string, destination: string) {
      await call("copy", path, { destination: checkedPath(destination) });
    },
    async delete(path: string) {
      await call("delete", path);
    },
  };
}

export function createRemoteStorageClient(node: WebDavStorageNode & { id?: string; driver: string }) {
  if (node.driver === "AGENT") {
    if (!node.id) throw bad();
    return createAgentFileClient(node.id);
  }
  return createWebDavClient(node);
}
