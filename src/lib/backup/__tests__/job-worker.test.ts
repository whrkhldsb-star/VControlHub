import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    claimNextJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
    failJobTerminal: vi.fn(),
    heartbeatJob: vi.fn(),
    getBackupRecord: vi.fn(),
    runExistingBackupRecord: vi.fn(),
    restoreBackupRecord: vi.fn(),
    drillBackupRecord: vi.fn(),
    pruneOldBackupRecordsNow: vi.fn(),
    runWithLeaseHeartbeat: vi.fn(),
    retryPendingOffsiteUploads: vi.fn(),
    retryPendingVpsOffsiteUploads: vi.fn(),
  },
}));

vi.mock("@/lib/job/service", () => ({
  claimNextJob: mocks.claimNextJob,
  completeJob: mocks.completeJob,
  failJob: mocks.failJob,
  failJobTerminal: mocks.failJobTerminal,
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

vi.mock("@/lib/backup/offsite-uploader", () => ({
  retryPendingOffsiteUploads: mocks.retryPendingOffsiteUploads,
}));

vi.mock("@/lib/backup/vps-backup-service", () => ({
  retryPendingVpsOffsiteUploads: mocks.retryPendingVpsOffsiteUploads,
}));

vi.mock("@/lib/storage/offsite/retention", () => ({
  pruneOffsiteObjects: vi.fn().mockResolvedValue(null),
}));

const {
  runBackupJobWorkerOnce,
  BACKUP_CREATE_JOB_TYPE,
  BACKUP_OFFSITE_SYNC_JOB_TYPE,
  BACKUP_RETENTION_JOB_TYPE,
} = await import("../job-worker");

describe("backup job worker create path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.heartbeatJob.mockResolvedValue({ count: 1 });
    mocks.completeJob.mockResolvedValue({ count: 1 });
    mocks.failJob.mockResolvedValue({ count: 1 });
    mocks.failJobTerminal.mockResolvedValue({ count: 1 });
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

  it("terminally fails (no retry) when the backup record is not found or out of scope", async () => {
    mocks.claimNextJob.mockResolvedValueOnce({
      id: "job_missing",
      type: BACKUP_CREATE_JOB_TYPE,
      payload: { backupId: "bak_missing" },
    });
    // getBackupRecord returns null → deleted row or outside this job's team scope.
    mocks.getBackupRecord.mockResolvedValueOnce(null);

    const ran = await runBackupJobWorkerOnce();
    expect(ran).toBe(true);
    // Must be terminal — retrying every 60s until maxAttempts cannot resurrect a
    // gone/out-of-scope record.
    expect(mocks.failJobTerminal).toHaveBeenCalledWith(
      "job_missing",
      expect.any(String),
      expect.stringContaining("not found or outside job team scope"),
    );
    expect(mocks.failJob).not.toHaveBeenCalled();
    expect(mocks.completeJob).not.toHaveBeenCalled();
  });

  it("terminally fails (no retry) on a malformed payload", async () => {
    mocks.claimNextJob.mockResolvedValueOnce({
      id: "job_badpayload",
      type: BACKUP_CREATE_JOB_TYPE,
      payload: {}, // missing backupId → PermanentBackupJobError
    });

    const ran = await runBackupJobWorkerOnce();
    expect(ran).toBe(true);
    expect(mocks.failJobTerminal).toHaveBeenCalledWith(
      "job_badpayload",
      expect.any(String),
      expect.stringContaining("backupId"),
    );
    expect(mocks.failJob).not.toHaveBeenCalled();
  });

  it("terminally fails (no retry) on an unsupported job type", async () => {
    mocks.claimNextJob.mockResolvedValueOnce({
      id: "job_unknown",
      type: "backup.not-a-real-type",
      payload: {},
    });

    const ran = await runBackupJobWorkerOnce();
    expect(ran).toBe(true);
    expect(mocks.failJobTerminal).toHaveBeenCalledWith(
      "job_unknown",
      expect.any(String),
      expect.stringContaining("Unsupported backup job type"),
    );
    expect(mocks.failJob).not.toHaveBeenCalled();
  });

  it("runs backup retention under lease-renewal and completes with the prune summary", async () => {
    mocks.claimNextJob.mockResolvedValueOnce({
      id: "job_retention",
      type: BACKUP_RETENTION_JOB_TYPE,
      payload: { olderThanDays: 30, teamId: "team_1" },
    });
    mocks.pruneOldBackupRecordsNow.mockResolvedValueOnce({
      deletedRecords: 12,
      filesDeleted: 12,
      filesSkipped: 0,
      fileErrors: 0,
      olderThanDays: 30,
      keepLatestPerType: 3,
      cutoff: new Date("2026-07-28T00:00:00.000Z"),
      oldestKeptByType: { DATABASE: new Date("2026-08-01T00:00:00.000Z"), FULL: null },
    });

    const ran = await runBackupJobWorkerOnce();
    expect(ran).toBe(true);
    // The (potentially long) prune must run under runWithLeaseHeartbeat so the
    // lease is renewed — otherwise it expires mid-prune and the stale reaper /
    // a sibling worker re-claims and runs a duplicate prune.
    expect(mocks.runWithLeaseHeartbeat).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job_retention",
        heartbeat: expect.any(Function),
        run: expect.any(Function),
      }),
    );
    expect(mocks.completeJob).toHaveBeenCalledWith(
      "job_retention",
      expect.any(String),
      expect.objectContaining({
        retention: expect.objectContaining({ deletedRecords: 12, filesDeleted: 12 }),
      }),
    );
    expect(mocks.failJob).not.toHaveBeenCalled();
    expect(mocks.failJobTerminal).not.toHaveBeenCalled();
  });

  it("fails the durable offsite-sync job when any upload fails", async () => {
    mocks.claimNextJob.mockResolvedValueOnce({
      id: "job_offsite_fail",
      type: BACKUP_OFFSITE_SYNC_JOB_TYPE,
      payload: {},
    });
    mocks.retryPendingOffsiteUploads.mockResolvedValueOnce({
      observed: 2,
      uploaded: 1,
      failed: 1,
      skipped: 0,
    });
    mocks.retryPendingVpsOffsiteUploads.mockResolvedValueOnce({
      observed: 1,
      uploaded: 1,
      failed: 0,
      skipped: 0,
    });

    const ran = await runBackupJobWorkerOnce();

    expect(ran).toBe(true);
    expect(mocks.failJob).toHaveBeenCalledWith(
      "job_offsite_fail",
      expect.any(String),
      expect.stringContaining("1 of 3"),
      expect.objectContaining({ retryAfterMs: 60_000 }),
    );
    expect(mocks.completeJob).not.toHaveBeenCalled();
  });

  it("completes the durable offsite-sync job when uploads have no failures", async () => {
    mocks.claimNextJob.mockResolvedValueOnce({
      id: "job_offsite_ok",
      type: BACKUP_OFFSITE_SYNC_JOB_TYPE,
      payload: {},
    });
    mocks.retryPendingOffsiteUploads.mockResolvedValueOnce({
      observed: 1,
      uploaded: 1,
      failed: 0,
      skipped: 0,
    });
    mocks.retryPendingVpsOffsiteUploads.mockResolvedValueOnce({
      observed: 0,
      uploaded: 0,
      failed: 0,
      skipped: 0,
    });

    const ran = await runBackupJobWorkerOnce();

    expect(ran).toBe(true);
    expect(mocks.completeJob).toHaveBeenCalledWith(
      "job_offsite_ok",
      expect.any(String),
      expect.objectContaining({ observed: 1, uploaded: 1, failed: 0 }),
    );
    expect(mocks.failJob).not.toHaveBeenCalled();
  });
});
