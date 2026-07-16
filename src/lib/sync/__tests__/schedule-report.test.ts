import { describe, expect, it } from "vitest";

import { isSyncJobDue, isValidSyncSchedule, normalizeSyncSchedule } from "../schedule";
import { parseSyncResultMessage, buildSyncReportView } from "../report";

describe("sync schedule", () => {
  it("normalizes manual to null", () => {
    expect(normalizeSyncSchedule("manual")).toBeNull();
    expect(normalizeSyncSchedule("every:1h")).toBe("every:1h");
  });

  it("validates presets and rejects garbage", () => {
    expect(isValidSyncSchedule("every:15m")).toBe(true);
    expect(isValidSyncSchedule("0 * * * *")).toBe(true);
    expect(isValidSyncSchedule("not a cron")).toBe(false);
  });

  it("due when never ran and scheduled", () => {
    expect(
      isSyncJobDue({ schedule: "every:1h", lastSyncAt: null, status: "IDLE" }),
    ).toBe(true);
  });

  it("not due when recently ran", () => {
    expect(
      isSyncJobDue({
        schedule: "every:1h",
        lastSyncAt: new Date(),
        status: "IDLE",
      }),
    ).toBe(false);
  });

  it("not due when running", () => {
    expect(
      isSyncJobDue({
        schedule: "every:15m",
        lastSyncAt: null,
        status: "RUNNING",
      }),
    ).toBe(false);
  });
});

describe("sync report", () => {
  it("parses bidirectional result", () => {
    const r = parseSyncResultMessage(
      "Bidirectional OK: A→B 2 files / B→A 3 files; total 5 transferred, 12s (newer-wins, no auto-delete)",
    );
    expect(r?.mode).toBe("bidirectional");
    expect(r?.transferredFiles).toBe(5);
    expect(r?.legs).toHaveLength(2);
  });

  it("builds conflict hints for BIDIRECTIONAL", () => {
    const view = buildSyncReportView({
      syncType: "BIDIRECTIONAL",
      lastSyncResult: "Bidirectional OK: A→B 1 files / B→A 0 files; total 1 transferred, 3s",
      logs: [],
    });
    expect(view.conflictHints.length).toBeGreaterThan(0);
  });
});
