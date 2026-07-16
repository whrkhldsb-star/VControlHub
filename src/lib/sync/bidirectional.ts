/**
 * Bidirectional (two-way) file sync helpers — pure policy + result merge.
 *
 * Product meaning of syncType BIDIRECTIONAL:
 * - Run A→B then B→A with rsync --update (skip files newer on receiver)
 * - Never auto-delete orphans on either side (conflict-safe; deletes must be manual)
 * - Not a full enterprise "drive" conflict-resolver; honest two-leg merge over SSH
 */
export type SyncDirectionMode = "MIRROR" | "BACKUP" | "INCREMENTAL" | "BIDIRECTIONAL";

export function isBidirectionalSyncType(syncType: string | null | undefined): boolean {
  return (syncType ?? "").toUpperCase() === "BIDIRECTIONAL";
}

/** Orphan deletion is unsafe for two-way merge — always disabled for BIDIRECTIONAL. */
export function effectiveDeleteOrphans(
  syncType: string | null | undefined,
  deleteOrphans: boolean,
): boolean {
  if (isBidirectionalSyncType(syncType)) return false;
  return deleteOrphans;
}

export type OneWaySyncStats = {
  totalFiles: number;
  transferredFiles: number;
  totalSize: number;
};

export function mergeSyncStats(
  a: OneWaySyncStats,
  b?: OneWaySyncStats | null,
): OneWaySyncStats {
  if (!b) return a;
  return {
    totalFiles: a.totalFiles + b.totalFiles,
    transferredFiles: a.transferredFiles + b.transferredFiles,
    totalSize: a.totalSize + b.totalSize,
  };
}

export function formatBidirectionalResult(input: {
  forward: OneWaySyncStats;
  reverse: OneWaySyncStats;
  durationMs: number;
}): string {
  const merged = mergeSyncStats(input.forward, input.reverse);
  const secs = Math.max(1, Math.round(input.durationMs / 1000));
  return `Bidirectional OK: A→B ${input.forward.transferredFiles} files / B→A ${input.reverse.transferredFiles} files; total ${merged.transferredFiles} transferred, ${secs}s (newer-wins, no auto-delete)`;
}

export function rsyncFlagsForJob(input: {
  syncType: string;
  deleteOrphans: boolean;
  compress: boolean;
}): string[] {
  const flags = ["-avz", "--stats"];
  if (isBidirectionalSyncType(input.syncType)) {
    flags.push("--update"); // skip files that are newer on the receiver
  }
  if (effectiveDeleteOrphans(input.syncType, input.deleteOrphans)) {
    flags.push("--delete");
  }
  if (input.compress) {
    flags.push("--compress");
  }
  return flags;
}
