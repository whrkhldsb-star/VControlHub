import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimNextJobMock,
  completeJobMock,
  failJobMock,
  heartbeatJobMock,
  getSftpSyncNodeMock,
  syncSftpDirectoryEntriesMock,
} = vi.hoisted(() => ({
  claimNextJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
  heartbeatJobMock: vi.fn(),
  getSftpSyncNodeMock: vi.fn(),
  syncSftpDirectoryEntriesMock: vi.fn(),
}));

vi.mock("@/lib/job/service", () => ({
  claimNextJob: claimNextJobMock,
  completeJob: completeJobMock,
  failJob: failJobMock,
  heartbeatJob: heartbeatJobMock,
}));

vi.mock("./sftp-sync", () => ({
  getSftpSyncNode: getSftpSyncNodeMock,
  syncSftpDirectoryEntries: syncSftpDirectoryEntriesMock,
}));

import { parseSftpSyncJobPayload, runSftpSyncJobWorkerOnce, SFTP_SYNC_JOB_TYPE } from "./sftp-sync-job";

const node = { id: "node_1", name: "remote", driver: "SFTP", basePath: "/data" };
const job = {
  id: "job_1",
  payload: { nodeId: "node_1", remotePath: "/logs", recursive: true, maxDepth: 3 },
};

describe("SFTP sync durable job worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimNextJobMock.mockResolvedValue(job);
    getSftpSyncNodeMock.mockResolvedValue(node);
    syncSftpDirectoryEntriesMock.mockResolvedValue({ synced: 2, created: 1, updated: 1, deleted: 0, errors: [] });
    heartbeatJobMock.mockResolvedValue({ count: 1 });
    completeJobMock.mockResolvedValue({ count: 1 });
    failJobMock.mockResolvedValue({ count: 1 });
  });

  it("parses a valid payload and rejects missing node ids", () => {
    expect(parseSftpSyncJobPayload(job.payload)).toEqual({ nodeId: "node_1", remotePath: "/logs", recursive: true, maxDepth: 3 });
    expect(() => parseSftpSyncJobPayload({ remotePath: "/logs" })).toThrow("SFTP sync job missing storage node");
  });

  it("claims and completes one queued SFTP sync job", async () => {
    await runSftpSyncJobWorkerOnce({ started: true, running: false, timer: null }, "test");

    expect(claimNextJobMock).toHaveBeenCalledWith(expect.objectContaining({ types: [SFTP_SYNC_JOB_TYPE] }));
    expect(getSftpSyncNodeMock).toHaveBeenCalledWith("node_1");
    expect(syncSftpDirectoryEntriesMock).toHaveBeenCalledWith({ node, remotePath: "/logs", recursive: true, maxDepth: 3 });
    expect(completeJobMock).toHaveBeenCalledWith("job_1", expect.stringContaining(":sftp-sync:"), { synced: 2, created: 1, updated: 1, deleted: 0, errors: [] });
    expect(failJobMock).not.toHaveBeenCalled();
  });

  it("fails and retries jobs when the remote scan makes no progress", async () => {
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({ synced: 0, created: 0, updated: 0, deleted: 0, errors: ["连接超时"] });

    await runSftpSyncJobWorkerOnce({ started: true, running: false, timer: null }, "test");

    expect(completeJobMock).not.toHaveBeenCalled();
    expect(failJobMock).toHaveBeenCalledWith("job_1", expect.stringContaining(":sftp-sync:"), "连接超时", { retryAfterMs: 60_000 });
  });
});
