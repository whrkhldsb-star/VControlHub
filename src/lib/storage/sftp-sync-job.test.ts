import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimNextJobMock,
  completeJobMock,
  failJobMock,
  failJobTerminalMock,
  loadJobOwnerSessionMock,
  assertStorageAccessMock,
  findApiTokenMock,
  heartbeatJobMock,
  getSftpSyncNodeMock,
  syncSftpDirectoryEntriesMock,
} = vi.hoisted(() => ({
  claimNextJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
  failJobTerminalMock: vi.fn(),
  loadJobOwnerSessionMock: vi.fn(),
  assertStorageAccessMock: vi.fn(),
  findApiTokenMock: vi.fn(),
  heartbeatJobMock: vi.fn(),
  getSftpSyncNodeMock: vi.fn(),
  syncSftpDirectoryEntriesMock: vi.fn(),
}));

vi.mock("@/lib/job/service", () => ({
  claimNextJob: claimNextJobMock,
  completeJob: completeJobMock,
  failJob: failJobMock,
  failJobTerminal: failJobTerminalMock,
  heartbeatJob: heartbeatJobMock,
}));
vi.mock("@/lib/job/heartbeat-runner", () => ({
  runWithLeaseHeartbeat: vi.fn(async (input: { run: () => Promise<unknown> }) =>
    input.run(),
  ),
}));

vi.mock("@/lib/api-token/authorization", () => ({ loadJobOwnerSession: loadJobOwnerSessionMock }));
vi.mock("@/lib/db", () => ({ prisma: { apiToken: { findFirst: findApiTokenMock } } }));
vi.mock("./access-control", () => ({ assertStorageAccess: assertStorageAccessMock }));
vi.mock("./sftp-sync", () => ({
  getSftpSyncNode: getSftpSyncNodeMock,
  syncSftpDirectoryEntries: syncSftpDirectoryEntriesMock,
}));

import {
  parseSftpSyncJobPayload,
  runSftpSyncJobWorkerOnce,
  SFTP_SYNC_JOB_TYPE,
} from "./sftp-sync-job";

const node = {
  id: "node_1",
  name: "remote",
  teamId: "team_a",
  driver: "SFTP",
  basePath: "/data",
};
const actor = { userId: "u_1", roles: ["admin"], permissions: ["storage:write"], currentTeamId: null };
const job = {
  id: "job_1",
  createdBy: actor.userId,
  teamId: node.teamId,
  payload: {
    userId: actor.userId,
    apiTokenId: null,
    teamId: null,
    targetTeams: { node_1: node.teamId },
    nodeId: "node_1",
    remotePath: "/logs",
    recursive: true,
    maxDepth: 3,
  },
};

describe("SFTP sync durable job worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    claimNextJobMock.mockResolvedValue(job);
    loadJobOwnerSessionMock.mockResolvedValue(actor);
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    getSftpSyncNodeMock.mockResolvedValue(node);
    syncSftpDirectoryEntriesMock.mockResolvedValue({
      synced: 2,
      created: 1,
      updated: 1,
      deleted: 0,
      errors: [],
    });
    heartbeatJobMock.mockResolvedValue({ count: 1 });
    completeJobMock.mockResolvedValue({ count: 1 });
    failJobMock.mockResolvedValue({ count: 1 });
  });

  it("parses a valid payload and rejects missing node ids", () => {
    expect(parseSftpSyncJobPayload(job.payload)).toEqual({
      nodeId: "node_1",
      remotePath: "/logs",
      recursive: true,
      maxDepth: 3,
    });
    expect(() => parseSftpSyncJobPayload({ remotePath: "/logs" })).toThrow(
      /SFTP sync job is missing its storage node|SFTP 同步任务缺少存储节点/,
    );
  });

  it("claims and completes one queued SFTP sync job", async () => {
    await runSftpSyncJobWorkerOnce(
      { started: true, running: false, timer: null },
      "test",
    );

    expect(claimNextJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ types: [SFTP_SYNC_JOB_TYPE] }),
    );
    expect(loadJobOwnerSessionMock).toHaveBeenCalledWith(actor.userId, null);
    expect(getSftpSyncNodeMock).toHaveBeenCalledWith("node_1", actor);
    expect(assertStorageAccessMock).toHaveBeenCalledWith({ session: actor, storageNodeId: node.id, relativePath: "logs", operation: "write" });
    expect(syncSftpDirectoryEntriesMock).toHaveBeenCalledWith({
      node,
      remotePath: "logs",
      recursive: true,
      maxDepth: 3,
    });
    expect(completeJobMock).toHaveBeenCalledWith(
      "job_1",
      expect.stringContaining(":sftp-sync:"),
      { synced: 2, created: 1, updated: 1, deleted: 0, errors: [] },
    );
    expect(failJobMock).not.toHaveBeenCalled();
  });

  it("requires a verifiable credential and original target scope for historical jobs", async () => {
    claimNextJobMock.mockResolvedValueOnce({ ...job, payload: { nodeId: node.id, teamId: node.teamId } });

    await runSftpSyncJobWorkerOnce({ started: true, running: false, timer: null }, "test");

    expect(failJobTerminalMock).toHaveBeenCalled();
    expect(syncSftpDirectoryEntriesMock).not.toHaveBeenCalled();
  });

  it.each([true, false])("revalidates a bound API token and preserves its limited permissions (active=%s)", async active => {
    const owner = { ...actor, currentTeamId: node.teamId };
    loadJobOwnerSessionMock.mockResolvedValueOnce(owner);
    claimNextJobMock.mockResolvedValueOnce({ ...job, payload: { ...job.payload, apiTokenId: "tok", teamId: node.teamId } });
    findApiTokenMock.mockResolvedValueOnce(active ? { id: "tok" } : null);

    await runSftpSyncJobWorkerOnce({ started: true, running: false, timer: null }, "test");

    expect(findApiTokenMock).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "tok", createdBy: actor.userId, teamId: node.teamId, revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }], scopes: { has: "storage:write" },
      },
    }));
    if (active) {
      expect(assertStorageAccessMock).toHaveBeenCalledWith(expect.objectContaining({ session: { ...owner, roles: [], permissions: ["storage:write"] } }));
      expect(syncSftpDirectoryEntriesMock).toHaveBeenCalled();
    } else {
      expect(failJobTerminalMock).toHaveBeenCalled();
      expect(syncSftpDirectoryEntriesMock).not.toHaveBeenCalled();
    }
  });

  it.each(["permission", "node team", "path grant", "account"])("stops before syncing when the %s changes", async (change) => {
    if (change === "permission") loadJobOwnerSessionMock.mockResolvedValueOnce({ ...actor, permissions: [] });
    if (change === "account") loadJobOwnerSessionMock.mockResolvedValueOnce(null);
    if (change === "node team") getSftpSyncNodeMock.mockResolvedValueOnce({ ...node, teamId: "team_b" });
    if (change === "path grant") assertStorageAccessMock.mockResolvedValueOnce({ allowed: false });

    await runSftpSyncJobWorkerOnce({ started: true, running: false, timer: null }, "test");

    expect(syncSftpDirectoryEntriesMock).not.toHaveBeenCalled();
    expect(failJobTerminalMock).toHaveBeenCalledWith(job.id, expect.any(String), expect.any(String));
  });

  it("fails and retries jobs when the remote scan makes no progress", async () => {
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({
      synced: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      errors: ["连接超时"],
    });

    await runSftpSyncJobWorkerOnce(
      { started: true, running: false, timer: null },
      "test",
    );

    expect(completeJobMock).not.toHaveBeenCalled();
    expect(failJobMock).toHaveBeenCalledWith(
      "job_1",
      expect.stringContaining(":sftp-sync:"),
      "SFTP sync failed (synced 0, created 0, updated 0, deleted 0, 1 error(s)): 连接超时",
      { retryAfterMs: 60_000 },
    );
  });

  it("fails and retries when a scan only partially succeeds", async () => {
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({
      synced: 3,
      created: 2,
      updated: 1,
      deleted: 0,
      errors: ["/logs/private: permission denied"],
});

    await runSftpSyncJobWorkerOnce(
      { started: true, running: false, timer: null },
      "test",
    );

    expect(completeJobMock).not.toHaveBeenCalled();
    // The rows that did land must survive into the error, otherwise a partial
    // scan is indistinguishable from one that synced nothing at all.
    expect(failJobMock).toHaveBeenCalledWith(
      "job_1",
      expect.stringContaining(":sftp-sync:"),
      "SFTP sync partially failed (synced 3, created 2, updated 1, deleted 0, 1 error(s)): /logs/private: permission denied",
      { retryAfterMs: 60_000 },
    );
  });

  it("caps the quoted errors so one message per failed file cannot grow the job row", async () => {
    syncSftpDirectoryEntriesMock.mockResolvedValueOnce({
      synced: 500,
      created: 500,
      updated: 0,
      deleted: 0,
      errors: Array.from({ length: 400 }, (_, index) => `/logs/f${index}: saving failed`),
    });

    await runSftpSyncJobWorkerOnce(
      { started: true, running: false, timer: null },
      "test",
    );

    const message = failJobMock.mock.calls[0]?.[2] as string;
    expect(message).toContain("400 error(s)");
    expect(message).toContain("; … 390 more");
    expect(message).not.toContain("/logs/f10:");
    expect(message.length).toBeLessThanOrEqual(2000);
  });
});
