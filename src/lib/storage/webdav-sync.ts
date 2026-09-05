import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma, isUniqueViolation } from "@/lib/db";
import { guessMimeType } from "@/lib/image-bed/constants";
import { createWebDavClient } from "./webdav-client";
import type { StorageFileNode } from "./file-content";
import { normalizeStorageTargetDirectory } from "./path-utils";

export async function getWebDavSyncNode(nodeId: string, session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">) {
  return prisma.storageNode.findFirst({
    where: { id: nodeId, ...teamWhere(session) },
    select: { id: true, driver: true, basePath: true, webdavConfigEncrypted: true },
  });
}

/** Depth-one inventory only. Never prune on an incomplete/failed remote response. */
export async function syncWebDavDirectoryEntries(input: { node: StorageFileNode; relativePath?: string }) {
  const result = { synced: 0, created: 0, updated: 0, deleted: 0, errors: [] as string[] };
  if (input.node.driver !== "WEBDAV") throw new Error("Storage node is not a WebDAV node");
  const dir = normalizeStorageTargetDirectory(input.relativePath);
  if (!dir.ok) { result.errors.push(dir.reason); return result; }
  try {
    const entries = await createWebDavClient(input.node).list(dir.path);
    const paths = new Set(entries.map((entry) => entry.relativePath));
    for (const entry of entries) {
      const where = { storageNodeId: input.node.id, relativePath: entry.relativePath };
      const data = { name: entry.name, entryType: entry.isDirectory ? "DIRECTORY" as const : "FILE" as const, mimeType: entry.isDirectory ? "inode/directory" : guessMimeType(entry.name), size: entry.isDirectory ? null : BigInt(entry.size) };
      const existing = await prisma.fileEntry.findFirst({ where });
      // Preserve recycle-bin tombstones; browsing must never resurrect deleted files.
      if (existing?.isDeleted) continue;
      if (existing) {
        await prisma.fileEntry.update({ where: { id: existing.id }, data });
        result.updated++;
      } else {
        try {
          await prisma.fileEntry.create({ data: { ...where, ...data, isDeleted: false } });
          result.created++;
        } catch (error) {
          if (!isUniqueViolation(error)) throw error;
          const raced = await prisma.fileEntry.findFirst({ where });
          if (!raced) throw error;
          if (!raced.isDeleted) {
            await prisma.fileEntry.update({ where: { id: raced.id }, data });
            result.updated++;
          }
        }
      }
      result.synced++;
    }
    const prefix = dir.path ? `${dir.path}/` : "";
    let cursorId: string | undefined;
    for (;;) {
      const indexed = await prisma.fileEntry.findMany({
        where: { storageNodeId: input.node.id, isDeleted: false, ...(prefix ? { relativePath: { startsWith: prefix } } : {}) },
        select: { id: true, relativePath: true }, orderBy: { id: "asc" }, take: 2000,
        ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
      });
      const stale = indexed.filter((entry) => {
        const remainder = entry.relativePath.slice(prefix.length);
        return remainder && !remainder.includes("/") && !paths.has(entry.relativePath);
      });
      if (stale.length) result.deleted += (await prisma.fileEntry.updateMany({ where: { id: { in: stale.map((entry) => entry.id) } }, data: { isDeleted: true } })).count;
      if (indexed.length < 2000) break;
      cursorId = indexed.at(-1)?.id;
    }
  } catch {
    // Never include provider URLs, credentials, or raw upstream bodies in UI warnings.
    result.errors.push("WebDAV directory sync failed; showing the last indexed listing");
  }
  return result;
}
