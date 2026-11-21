import { createHash } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/db";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { storageAccessDeniedCopy } from "./access-denied";
import { BusinessError } from "@/lib/errors";
import { resolveManagedLocalEntryPath, statBackingObject, type StorageNodeWithCredentials } from "./fs-backend";

type MoveEntry = { relativePath: string; entryType: string; size: bigint | null };
const limit = 10_000;
const incomplete = () => new BusinessError(storageAccessDeniedCopy("unmetered_tree_write"));

/** Called only for capacity-limited destinations. Bytes must also be fully represented in future quota sums. */
export function moveMeasurement(node: StorageNodeWithCredentials & { id: string }, entry: MoveEntry) {
  return async () => {
    if (entry.entryType !== "DIRECTORY") {
      const physical = await statBackingObject({ storageNode: node, relativePath: entry.relativePath });
      if (!physical || physical.isDirectory || BigInt(physical.size) !== entry.size) throw incomplete();
      return { bytes: entry.size, largest: entry.size, version: String(physical.lastModifiedMs) };
    }
    // These remote drivers expose no atomic subtree inventory or revision fence.
    if (node.driver !== "LOCAL") throw incomplete();
    const rows = await prisma.fileEntry.findMany({
      where: { storageNodeId: node.id, relativePath: { startsWith: escapeLikeLiteral(entry.relativePath + "/") } },
      select: { relativePath: true, size: true, isDeleted: true, entryType: true }, take: limit + 1,
    });
    if (rows.length > limit) throw incomplete();
    const indexed = new Map(rows.map(row => [row.relativePath, row]));
    const root = await resolveManagedLocalEntryPath({ basePath: node.basePath, relativePath: entry.relativePath });
    const digest = createHash("sha256");
    let bytes = BigInt(0), largest = BigInt(0);
    const pending = [{ absolute: root.absolutePath, relative: entry.relativePath }];
    while (pending.length) {
      const dir = pending.pop()!;
      const before = await lstat(dir.absolute, { bigint: true });
      if (!before.isDirectory()) throw incomplete();
      const children = (await readdir(dir.absolute, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
      for (const child of children) {
        const relative = dir.relative + "/" + child.name;
        const row = indexed.get(relative);
        if (!row || row.isDeleted) throw incomplete();
        indexed.delete(relative);
        const absolute = path.join(dir.absolute, child.name);
        const stat = await lstat(absolute, { bigint: true });
        digest.update(JSON.stringify([relative, String(stat.dev), String(stat.ino), String(stat.ctimeNs), String(stat.size)]));
        if (stat.isDirectory() && row.entryType === "DIRECTORY") pending.push({ absolute, relative });
        else if (stat.isFile() && row.entryType === "FILE" && row.size === stat.size) {
          bytes += stat.size;
          if (stat.size > largest) largest = stat.size;
        } else throw incomplete();
      }
      const after = await lstat(dir.absolute, { bigint: true });
      if (before.dev !== after.dev || before.ino !== after.ino || before.ctimeNs !== after.ctimeNs) throw incomplete();
      digest.update(JSON.stringify([dir.relative, String(after.dev), String(after.ino), String(after.ctimeNs)]));
    }
    if (indexed.size) throw incomplete();
    return { bytes, largest, version: digest.digest("hex") };
  };
}
