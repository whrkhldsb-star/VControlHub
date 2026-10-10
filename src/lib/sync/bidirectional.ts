
export function isBidirectionalSyncType(syncType: string | null | undefined): boolean {
  return (syncType ?? "").toUpperCase() === "BIDIRECTIONAL";
}

/** Orphan deletion is unsafe for two-way merge — always disabled for BIDIRECTIONAL. */
export function effectiveDeleteOrphans(
  syncType: string | null | undefined,
  deleteOrphans: boolean,
): boolean {
  if (isBidirectionalSyncType(syncType)) return false;
	if ((syncType ?? "").toUpperCase() === "MIRROR") return true;
  return deleteOrphans;
}

/** Lexical normalization shared by the browser and server endpoint policy. */
export function normalizeSyncEndpointPath(raw: string): string {
  const path = raw.trim().replace(/\\/g, "/") || "/";
  const absolute = path.startsWith("/");
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length && segments.at(-1) !== "..") segments.pop();
      else if (!absolute) segments.push(segment);
    } else segments.push(segment);
  }
  return (absolute ? "/" : "") + segments.join("/") || ".";
}

/** Copying into a descendant recurses; mirroring into an ancestor can delete the source. */
export function syncEndpointsOverlap(input: {
  sourceServerId: string;
  targetServerId: string;
  sourcePath: string;
  targetPath: string;
}): boolean {
  if (input.sourceServerId !== input.targetServerId) return false;
  const source = normalizeSyncEndpointPath(input.sourcePath);
  const target = normalizeSyncEndpointPath(input.targetPath);
  const contains = (parent: string, child: string) => parent === "."
    ? !child.startsWith("/") && child !== ".." && !child.startsWith("../")
    : child.startsWith(parent === "/" ? "/" : `${parent}/`);
  return source === target || contains(source, target) || contains(target, source);
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
  // Base archive+verbose only; compression is controlled solely by input.compress
  // (do not bake "z" into the short flags — that made the UI toggle a no-op).
  const flags = ["-av", "--stats"];
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
