import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { guessMimeType } from "@/lib/image-bed/constants";
import { createLogger } from "@/lib/logging";
import { createWebDavClient } from "./webdav-client";
import type { StorageFileNode } from "./file-content";
import { normalizeStorageTargetDirectory } from "./path-utils";

const logger = createLogger("storage.webdav-sync");
const PAGE_SIZE = 2000;
const WRITE_BATCH_SIZE = 500;
const inventorySelect = {
  id: true, relativePath: true, isDeleted: true,
  name: true, entryType: true, mimeType: true, size: true,
} as const;
type IndexedEntry = {
  id: string; relativePath: string; isDeleted: boolean;
  name: string; entryType: string; mimeType: string | null; size: bigint | null;
};

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
  let phase: "list" | "index" = "list";
  try {
    // Finish the remote read before opening a database transaction.
    const entries = [...new Map((await createWebDavClient(input.node).list(dir.path)).map((entry) => [entry.relativePath, entry])).values()];
    const paths = new Set(entries.map((entry) => entry.relativePath));
    const prefix = dir.path ? `${dir.path}/` : "";
    phase = "index";
    const counts = await prisma.$transaction(async (tx) => {
      const counts = { synced: 0, created: 0, updated: 0, deleted: 0 };
      const indexed = new Map<string, IndexedEntry>();
      let cursorId: string | undefined;
      // Include tombstones in the batch lookup. Read every page before pruning.
      for (;;) {
        const page = await tx.fileEntry.findMany({
          where: { storageNodeId: input.node.id, ...(prefix ? { relativePath: { startsWith: prefix } } : {}) },
          select: inventorySelect, orderBy: { id: "asc" }, take: PAGE_SIZE,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        });
        for (const entry of page) {
          const remainder = entry.relativePath.slice(prefix.length);
          if (remainder && !remainder.includes("/")) indexed.set(entry.relativePath, entry);
        }
        if (page.length < PAGE_SIZE) break;
        cursorId = page.at(-1)!.id;
      }
      const dataFor = (entry: (typeof entries)[number]) => ({
        name: entry.name, entryType: entry.isDirectory ? "DIRECTORY" as const : "FILE" as const,
        mimeType: entry.isDirectory ? "inode/directory" : guessMimeType(entry.name),
        size: entry.isDirectory ? null : BigInt(entry.size),
      });
      const syncExisting = async (existing: IndexedEntry, entry: (typeof entries)[number]) => {
        if (existing.isDeleted) return;
        const data = dataFor(entry);
        if (existing.name === data.name && existing.entryType === data.entryType &&
            existing.mimeType === data.mimeType && existing.size === data.size) {
          counts.synced += 1;
          return;
        }
        // Predicate guards against recycle-bin races; never write isDeleted=false here.
        const updated = await tx.fileEntry.updateMany({ where: { id: existing.id, isDeleted: false }, data });
        counts.updated += updated.count;
        counts.synced += updated.count;
      };
      for (const entry of entries) {
        const existing = indexed.get(entry.relativePath);
        if (existing) await syncExisting(existing, entry);
      }
      const missing = entries.filter((entry) => !indexed.has(entry.relativePath));
      for (let offset = 0; offset < missing.length; offset += WRITE_BATCH_SIZE) {
        const batch = missing.slice(offset, offset + WRITE_BATCH_SIZE);
        // Avoid catching a unique violation inside a PostgreSQL transaction (it aborts it).
        const created = await tx.fileEntry.createMany({
          data: batch.map((entry) => ({ storageNodeId: input.node.id, relativePath: entry.relativePath, ...dataFor(entry), isDeleted: false })),
          skipDuplicates: true,
        });
        counts.created += created.count;
        // The transaction owns these inserts; no conflict read or second write is needed.
        if (created.count === batch.length) {
          counts.synced += created.count;
          continue;
        }
        const resolved = await tx.fileEntry.findMany({
          where: { storageNodeId: input.node.id, relativePath: { in: batch.map((entry) => entry.relativePath) } },
          select: inventorySelect,
        });
        const byPath = new Map(resolved.map((entry) => [entry.relativePath, entry]));
        for (const entry of batch) {
          const existing = byPath.get(entry.relativePath);
          if (!existing) throw new Error("WebDAV index conflict unresolved");
          // Fresh inserts compare equal; only changed, live conflict winners need a write.
          await syncExisting(existing, entry);
        }
      }
      const stale = [...indexed.values()].filter((entry) => !entry.isDeleted && !paths.has(entry.relativePath));
      // Remote absence is not a user deletion. Remove only live index rows, so a
      // returning remote object can be indexed again. Existing isDeleted rows are
      // ambiguous legacy tombstones and MUST NOT be automatically resurrected.
      for (let offset = 0; offset < stale.length; offset += WRITE_BATCH_SIZE) {
        counts.deleted += (await tx.fileEntry.deleteMany({
          where: { storageNodeId: input.node.id, id: { in: stale.slice(offset, offset + WRITE_BATCH_SIZE).map((entry) => entry.id) }, isDeleted: false, versions: { none: {} }, children: { none: {} } },
        })).count;
      }
      // Conservatively preserve history/children. Do not disguise remote absence as
      // a recycle-bin tombstone or silently report a completely reconciled listing.
      // A future remoteMissingAt field must be wired through every reader/writer,
      // including raw SQL, share/download access and ancestor visibility, atomically.
      return { ...counts, retainedMissing: stale.length - counts.deleted };
    }, { isolationLevel: "Serializable", timeout: 60_000 });
    // Only report counters after commit; any page/write/prune failure rolls back.
    const { retainedMissing, ...committedCounts } = counts;
    Object.assign(result, committedCounts);
    if (retainedMissing > 0) {
      result.errors.push("Some remote-missing entries were retained to preserve file history or child indexes");
    }
  } catch {
    // Allowlisted context only: no exception, upstream body, URL, path or credentials.
    logger.warn("WebDAV directory sync failed", { storageNodeId: input.node.id, phase });
    result.errors.push("WebDAV directory sync failed; showing the last indexed listing");
  }
  return result;
}
