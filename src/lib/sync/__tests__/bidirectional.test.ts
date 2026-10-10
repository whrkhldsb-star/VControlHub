import { describe, expect, it } from "vitest";

import {
  effectiveDeleteOrphans,
  formatBidirectionalResult,
  isBidirectionalSyncType,
  mergeSyncStats,
  normalizeSyncEndpointPath,
  rsyncFlagsForJob,
  syncEndpointsOverlap,
} from "../bidirectional";

describe("bidirectional sync policy", () => {
  it("detects BIDIRECTIONAL", () => {
    expect(isBidirectionalSyncType("BIDIRECTIONAL")).toBe(true);
    expect(isBidirectionalSyncType("MIRROR")).toBe(false);
  });

  it("forces deleteOrphans off for bidirectional", () => {
    expect(effectiveDeleteOrphans("BIDIRECTIONAL", true)).toBe(false);
    expect(effectiveDeleteOrphans("MIRROR", true)).toBe(true);
	expect(effectiveDeleteOrphans("MIRROR", false)).toBe(true);
  });

  it("adds --update and never --delete for bidirectional flags", () => {
    const flags = rsyncFlagsForJob({
      syncType: "BIDIRECTIONAL",
      deleteOrphans: true,
      compress: false,
    });
    expect(flags).toContain("--update");
    expect(flags).not.toContain("--delete");
    expect(flags).toContain("-av");
    expect(flags).not.toContain("-avz");
    expect(flags).not.toContain("--compress");
  });

  it("adds --compress only when compress is enabled", () => {
    const compressed = rsyncFlagsForJob({
      syncType: "MIRROR",
      deleteOrphans: false,
      compress: true,
    });
    const plain = rsyncFlagsForJob({
      syncType: "MIRROR",
      deleteOrphans: false,
      compress: false,
    });
    expect(compressed).toContain("--compress");
    expect(plain).not.toContain("--compress");
    expect(plain).not.toContain("-avz");
  });

  it("merges leg stats and formats result", () => {
    const merged = mergeSyncStats(
      { totalFiles: 10, transferredFiles: 2, totalSize: 100 },
      { totalFiles: 10, transferredFiles: 3, totalSize: 50 },
    );
    expect(merged.transferredFiles).toBe(5);
    expect(
      formatBidirectionalResult({
        forward: { totalFiles: 10, transferredFiles: 2, totalSize: 100 },
        reverse: { totalFiles: 10, transferredFiles: 3, totalSize: 50 },
        durationMs: 2500,
      }),
    ).toMatch(/Bidirectional OK/);
  });
});

describe("sync endpoint paths", () => {
  it("normalizes separators, dot segments and trailing slashes", () => {
    expect(normalizeSyncEndpointPath(" /data//./share/ ")).toBe("/data/share");
    expect(normalizeSyncEndpointPath("/data/a/../b")).toBe("/data/b");
    expect(normalizeSyncEndpointPath("/../..")).toBe("/");
    expect(normalizeSyncEndpointPath("C:\\data\\x")).toBe("C:/data/x");
    expect(normalizeSyncEndpointPath("")).toBe("/");
  });

  const sameNode = (sourcePath: string, targetPath: string) =>
    syncEndpointsOverlap({ sourceServerId: "s", targetServerId: "s", sourcePath, targetPath });

  it("rejects identical, nested and equivalent directories on one node", () => {
    expect(sameNode("/data", "/data/")).toBe(true);
    expect(sameNode("/data", "/data/archive")).toBe(true);
    expect(sameNode("/data/archive", "/data")).toBe(true);
    expect(sameNode("/data/./x/..", "/data")).toBe(true);
    expect(sameNode("/", "/srv")).toBe(true);
  });

  it("allows sibling names and different nodes", () => {
    expect(sameNode("/data", "/database")).toBe(false);
    expect(syncEndpointsOverlap({ sourceServerId: "a", targetServerId: "b", sourcePath: "/data", targetPath: "/data" })).toBe(false);
  });
});
