import { describe, expect, it } from "vitest";

import {
  effectiveDeleteOrphans,
  formatBidirectionalResult,
  isBidirectionalSyncType,
  mergeSyncStats,
  rsyncFlagsForJob,
} from "../bidirectional";

describe("bidirectional sync policy", () => {
  it("detects BIDIRECTIONAL", () => {
    expect(isBidirectionalSyncType("BIDIRECTIONAL")).toBe(true);
    expect(isBidirectionalSyncType("MIRROR")).toBe(false);
  });

  it("forces deleteOrphans off for bidirectional", () => {
    expect(effectiveDeleteOrphans("BIDIRECTIONAL", true)).toBe(false);
    expect(effectiveDeleteOrphans("MIRROR", true)).toBe(true);
  });

  it("adds --update and never --delete for bidirectional flags", () => {
    const flags = rsyncFlagsForJob({
      syncType: "BIDIRECTIONAL",
      deleteOrphans: true,
      compress: false,
    });
    expect(flags).toContain("--update");
    expect(flags).not.toContain("--delete");
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
