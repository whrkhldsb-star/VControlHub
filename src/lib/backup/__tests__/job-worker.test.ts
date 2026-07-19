import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    claimNextJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
    heartbeatJob: vi.fn(),
    getBackupRecord: vi.fn(),
    runExistingBackupRecord: vi.fn(),
    restoreBackupRecord: vi.fn(),
    drillBackupRecord: vi.fn(),
    pruneOldBackupRecordsNow: vi.fn(),
    runWithLeaseHeartbeat: vi.fn(),
  },
}));

vi.mock("@/lib/job/service", () => ({
  claimNextJob: mocks.claimNextJob,
  completeJob: mocks.completeJob,
  failJob: mocks.failJob,
  heartbeatJob: mocks.heartbeatJob,
}));

vi.mock("@/lib/job/heartbeat-runner", () => ({
  runWithLeaseHeartbeat: mocks.runWithLeaseHeartbeat,
}));

vi.mock("@/lib/job/lease", () => ({
  computeLeaseMs: () => 30_000,
}));

vi.mock("@/lib/config/env", () => ({
  config: { app: { hostname: "test-host", appDir: "/opt/app" } },
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("@/lib/backup/service", () => ({
  getBackupRecord: mocks.getBackupRecord,
  runExistingBackupRecord: mocks.runExistingBackupRecord,
  restoreBackupRecord: mocks.restoreBackupRecord,
  drillBackupRecord: mocks.drillBackupRecord,
  pruneOldBackupRecordsNow: mocks.pruneOldBackupRecordsNow,
  abandonStalePendingBackupRecords: vi.fn().mockResolvedValue({ abandoned: 0, ids: [] }),
}));

const { runBackupJobWorkerOnce, BACKUP_CREATE_JOB_TYPE } = await import("../job-worker");

describe("backup job worker create path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.heartbeatJob.mockResolvedValue({ count: 1 });
    mocks.completeJob.mockResolvedValue({ count: 1 });
    mocks.failJob.mockResolvedValue({ count: 1 });
    mocks.runWithLeaseHeartbeat.mockImplementation(async ({ run }: { run: () => Promise<unknown> }) => run());
  });

  it("fails the durable job when runExistingBackupRecord returns FAILED (no throw)", async () => {
    mocks.claimNextJob.mockResolvedValueOnce({
      id: "job_fail",
      type: BACKUP_CREATE_JOB_TYPE,
      payload: { backupId: "bak_fail" },
    });
    mocks.getBackupRecord.mockResolvedValueOnce({ id: "bak_fail", type: "DATABASE", status: "PENDING" });
    mocks.runExistingBackupRecord.mockResolvedValueOnce({
      id: "bak_fail",
      status: "FAILED",
      filePath: "backups/database.sql.gz",
      fileSize: null,
      errorMessage: "tar failed: disk full",
    });

    const ran = await runBackupJobWorkerOnce();
    expect(ran).toBe(true);
    expect(mocks.failJob).toHaveBeenCalledWith(
      "job_fail",
      expect.any(String),
      expect.stringContaining("tar failed"),
      expect.objectContaining({ retryAfterMs: 60_000 }),
    );
    expect(mocks.completeJob).not.toHaveBeenCalled();
  });

  it("completes the durable job only when backup status is COMPLETED", async () => {
    mocks.claimNextJob.mockResolvedValueOnce({
      id: "job_ok",
      type: BACKUP_CREATE_JOB_TYPE,
      payload: { backupId: "bak_ok" },
    });
    mocks.getBackupRecord.mockResolvedValueOnce({ id: "bak_ok", type: "FULL", status: "PENDING" });
    mocks.runExistingBackupRecord.mockResolvedValueOnce({
      id: "bak_ok",
      status: "COMPLETED",
      filePath: "backups/full.tar.gz",
      fileSize: "1234",
      errorMessage: null,
    });

    const ran = await runBackupJobWorkerOnce();
    expect(ran).toBe(true);
    expect(mocks.completeJob).toHaveBeenCalledWith(
      "job_ok",
      expect.any(String),
      expect.objectContaining({ backupId: "bak_ok", status: "COMPLETED" }),
    );
    expect(mocks.failJob).not.toHaveBeenCalled();
  });
});
