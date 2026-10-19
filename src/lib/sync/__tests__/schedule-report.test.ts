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

  it("a never-run cron job waits for its first occurrence after creation", () => {
    // Counting from 1970 made every new cron job run at once.
    const createdAt = new Date("2026-10-19T02:10:00Z"); // 10:10 Asia/Shanghai
    const daily3am = { schedule: "0 3 * * *", lastSyncAt: null, createdAt, status: "IDLE" };
    expect(isSyncJobDue({ ...daily3am, now: new Date("2026-10-19T02:11:00Z") })).toBe(false);
    expect(isSyncJobDue({ ...daily3am, now: new Date("2026-10-19T19:00:00Z") })).toBe(true); // 03:00 next day
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

  it("reports the forward leg of a partial bidirectional run instead of zero", () => {
    const r = parseSyncResultMessage(
      "Partial: forward completed (12 files, 4.2 MB, 37s); reverse failed: rsync failed (exit 23): permission denied. Bidirectional sync is not transactional.",
    );
    expect(r?.mode).toBe("bidirectional");
    expect(r?.transferredFiles).toBe(12);
    expect(r?.durationSec).toBe(37);
    expect(r?.legs).toEqual([
      { direction: "forward", transferredFiles: 12, totalFiles: 12, totalSize: 0 },
      { direction: "reverse", transferredFiles: 0, totalFiles: 0, totalSize: 0 },
    ]);
    expect(r?.notes[0]).toContain("permission denied");
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
