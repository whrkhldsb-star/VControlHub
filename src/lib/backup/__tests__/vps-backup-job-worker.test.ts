import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimNextJobMock,
  completeJobMock,
  failJobMock,
  failJobTerminalMock,
  heartbeatJobMock,
  runVpsBackupRecordMock,
  forceFailVpsBackupRecordIfRunningMock,
} = vi.hoisted(() => ({
  claimNextJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
  failJobTerminalMock: vi.fn(),
  heartbeatJobMock: vi.fn(),
  runVpsBackupRecordMock: vi.fn(),
  forceFailVpsBackupRecordIfRunningMock: vi.fn(),
}));

vi.mock("@/lib/job/service", () => ({
  claimNextJob: claimNextJobMock,
  completeJob: completeJobMock,
  failJob: failJobMock,
  failJobTerminal: failJobTerminalMock,
  heartbeatJob: heartbeatJobMock,
}));

vi.mock("../vps-backup-service", () => ({
  runVpsBackupRecord: runVpsBackupRecordMock,
  forceFailVpsBackupRecordIfRunning: forceFailVpsBackupRecordIfRunningMock,
  VPS_BACKUP_CREATE_JOB_TYPE: "vps-backup.create",
}));

const { runVpsBackupJobWorkerOnce } = await import("../vps-backup-job-worker");

function failure(errorMessage: string) {
  return {
    success: false,
    fileSize: null,
    checksumSha256: null,
    localPath: null,
    remotePath: null,
    errorMessage,
  };
}

describe("runVpsBackupJobWorkerOnce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    heartbeatJobMock.mockResolvedValue({ count: 1 });
  });

  it("does nothing when the queue is empty", async () => {
    claimNextJobMock.mockResolvedValue(null);
    await runVpsBackupJobWorkerOnce();
    expect(runVpsBackupRecordMock).not.toHaveBeenCalled();
  });

  it("completes the job with the backup artefact metadata", async () => {
    claimNextJobMock.mockResolvedValue({ id: "job_1", payload: { recordId: "rec_1" } });
    runVpsBackupRecordMock.mockResolvedValue({
      success: true,
      fileSize: 2048,
      checksumSha256: "abc",
      localPath: "/backups/rec_1.tar.zst",
    });

    await runVpsBackupJobWorkerOnce();

    expect(runVpsBackupRecordMock).toHaveBeenCalledWith("rec_1", undefined);
    expect(completeJobMock).toHaveBeenCalledWith("job_1", expect.any(String), {
      fileSize: 2048,
      checksumSha256: "abc",
      localPath: "/backups/rec_1.tar.zst",
    });
    expect(failJobMock).not.toHaveBeenCalled();
    expect(failJobTerminalMock).not.toHaveBeenCalled();
  });

  it("forwards sanitised custom paths, capped at 20", async () => {
    claimNextJobMock.mockResolvedValue({
      id: "job_1",
      payload: {
        recordId: "rec_1",
        paths: ["/etc", "  ", 42, ...Array.from({ length: 25 }, (_, i) => `/d${i}`)],
      },
    });
    runVpsBackupRecordMock.mockResolvedValue({ success: true, fileSize: 1, checksumSha256: "x", localPath: "/p" });

    await runVpsBackupJobWorkerOnce();

    const paths = runVpsBackupRecordMock.mock.calls[0]?.[1]?.paths as string[];
    expect(paths).toHaveLength(20);
    expect(paths[0]).toBe("/etc");
    expect(paths).not.toContain("  ");
  });

  it("fails a payload without a recordId terminally instead of retrying it", async () => {
    claimNextJobMock.mockResolvedValue({ id: "job_1", payload: { paths: ["/etc"] } });

    await runVpsBackupJobWorkerOnce();

    expect(failJobTerminalMock).toHaveBeenCalledWith(
      "job_1",
      expect.any(String),
      "Missing recordId in job payload",
    );
    // A malformed payload never becomes valid; a retry would only burn attempts.
    expect(failJobMock).not.toHaveBeenCalled();
    expect(runVpsBackupRecordMock).not.toHaveBeenCalled();
  });

  it("fails terminally when the backup reports failure, keeping the real cause", async () => {
    claimNextJobMock.mockResolvedValue({ id: "job_1", payload: { recordId: "rec_1" } });
    runVpsBackupRecordMock.mockResolvedValue(failure("SSH connection refused"));

    await runVpsBackupJobWorkerOnce();

    // Retrying would re-enter runVpsBackupRecord, miss its `status: PENDING`
    // CAS and overwrite this message with "already running or completed".
    expect(failJobTerminalMock).toHaveBeenCalledWith(
      "job_1",
      expect.any(String),
      "SSH connection refused",
    );
    expect(failJobMock).not.toHaveBeenCalled();
  });

  it("still retries a thrown error, which may have happened before the record was claimed", async () => {
    claimNextJobMock.mockResolvedValue({ id: "job_1", payload: { recordId: "rec_1" } });
    runVpsBackupRecordMock.mockRejectedValue(new Error("db unavailable"));
    forceFailVpsBackupRecordIfRunningMock.mockResolvedValue(undefined);

    await runVpsBackupJobWorkerOnce();

    expect(failJobMock).toHaveBeenCalledWith("job_1", expect.any(String), "db unavailable");
    expect(failJobTerminalMock).not.toHaveBeenCalled();
    expect(forceFailVpsBackupRecordIfRunningMock).toHaveBeenCalledWith(
      "rec_1",
      "Job worker failed: db unavailable",
    );
  });
});
