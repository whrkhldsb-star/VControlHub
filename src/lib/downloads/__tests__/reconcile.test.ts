import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Coverage for the background DownloadTask reconciler. It must NEVER fail a task
 * on updatedAt staleness alone (a large unwatched direct download has a stale
 * row while curl is still writing) — it only transitions on a definitive remote
 * answer, or after a generous unreachable window.
 */

const prismaMock = {
  downloadTask: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
};
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const ssh = {
  execRemoteCommand: vi.fn(async () => ({ stdout: "RUNNING\n0", exitCode: 0 })),
  buildSshParamsFromServer: vi.fn(async () => ({ host: "h", port: 22, username: "u" })),
};
vi.mock("@/lib/ssh/client", () => ssh);

const aria2 = {
  ensureAria2Daemon: vi.fn(async () => undefined),
  tellStatus: vi.fn(async () => ({ status: "active" })),
};
vi.mock("@/lib/aria2/service", () => aria2);

const helpers = {
  indexDownloadedFileEntry: vi.fn(async () => undefined),
  deriveDownloadFileNameFromUrl: vi.fn(() => "derived.bin"),
};
vi.mock("@/lib/downloads/helpers", () => helpers);
vi.mock("@/lib/downloads/remote-command", () => ({ shellQuote: (s: string) => `'${s}'` }));
vi.mock("@/lib/logging", () => ({ logError: vi.fn() }));

const { reconcileStaleRunningDownloadTasks } = await import("../reconcile");

const baseServer = {
  host: "h", port: 22, username: "u", sshKeyId: null, password: null, hostKeySha256: "ab",
  sshKey: { privateKey: "k" }, storageNode: { id: "node-1", basePath: "/data" },
};

function directRow(over: Record<string, unknown> = {}) {
  return {
    id: "t-direct", url: "http://x/f.bin", fileName: null, targetPath: "/data/dl",
    pid: 4321, aria2Gid: null, status: "RUNNING",
    updatedAt: new Date(Date.now() - 20 * 60_000), server: baseServer, ...over,
  };
}
function relayRow(over: Record<string, unknown> = {}) {
  return {
    id: "t-relay", url: "http://x/f.bin", fileName: null, targetPath: "/data/dl",
    pid: null, aria2Gid: "gid-1", status: "RUNNING",
    updatedAt: new Date(Date.now() - 4 * 60 * 60_000), server: baseServer, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.downloadTask.updateMany.mockResolvedValue({ count: 1 });
  ssh.buildSshParamsFromServer.mockResolvedValue({ host: "h", port: 22, username: "u" });
});

describe("reconcileStaleRunningDownloadTasks — direct", () => {
  it("completes a direct download whose remote exit marker says success", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([directRow()]);
    ssh.execRemoteCommand.mockResolvedValueOnce({ stdout: "COMPLETED\n12345\n/data/dl/f.bin", exitCode: 0 });

    const res = await reconcileStaleRunningDownloadTasks();

    expect(res.completed).toBe(1);
    const call = prismaMock.downloadTask.updateMany.mock.calls[0]![0] as { where: { status: string }; data: { status: string } };
    expect(call.where.status).toBe("RUNNING");
    expect(call.data.status).toBe("COMPLETED");
    expect(helpers.indexDownloadedFileEntry).toHaveBeenCalledTimes(1);
  });

  it("leaves a direct download whose pid is still alive untouched", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([directRow()]);
    ssh.execRemoteCommand.mockResolvedValueOnce({ stdout: "RUNNING\n0", exitCode: 0 });

    const res = await reconcileStaleRunningDownloadTasks();

    expect(res.completed).toBe(0);
    expect(res.failed).toBe(0);
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled();
  });

  it("fails a direct download whose remote process failed", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([directRow()]);
    ssh.execRemoteCommand.mockResolvedValueOnce({ stdout: "FAILED\n0", exitCode: 0 });

    const res = await reconcileStaleRunningDownloadTasks();

    expect(res.failed).toBe(1);
    const call = prismaMock.downloadTask.updateMany.mock.calls[0]![0] as { data: { status: string } };
    expect(call.data.status).toBe("FAILED");
  });

  it("does NOT fail a direct download on a transient SSH error within the window", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([directRow()]);
    ssh.execRemoteCommand.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));

    const res = await reconcileStaleRunningDownloadTasks();

    expect(res.failed).toBe(0);
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled();
  });

  it("fails a direct download unreachable beyond the give-up window", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      directRow({ updatedAt: new Date(Date.now() - 7 * 60 * 60_000) }),
    ]);
    ssh.execRemoteCommand.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));

    const res = await reconcileStaleRunningDownloadTasks();

    expect(res.failed).toBe(1);
  });
});

describe("reconcileStaleRunningDownloadTasks — relay", () => {
  it("skips a relay task not yet stale past the download cap", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      relayRow({ updatedAt: new Date(Date.now() - 30 * 60_000) }),
    ]);

    const res = await reconcileStaleRunningDownloadTasks();

    expect(res.completed + res.failed).toBe(0);
    expect(aria2.tellStatus).not.toHaveBeenCalled();
  });

  it("fails a long-stale relay task once aria2 reports complete (transfer unconfirmed)", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([relayRow()]);
    aria2.tellStatus.mockResolvedValueOnce({ status: "complete" });

    const res = await reconcileStaleRunningDownloadTasks();

    expect(res.failed).toBe(1);
  });

  it("leaves a long-stale relay task still actively downloading in aria2", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([relayRow()]);
    aria2.tellStatus.mockResolvedValueOnce({ status: "active" });

    const res = await reconcileStaleRunningDownloadTasks();

    expect(res.completed + res.failed).toBe(0);
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled();
  });
});

describe("reconcileStaleRunningDownloadTasks — neither pid nor gid", () => {
  it("fails a very stale task that never recorded pid or gid", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      directRow({ pid: null, aria2Gid: null, updatedAt: new Date(Date.now() - 7 * 60 * 60_000) }),
    ]);

    const res = await reconcileStaleRunningDownloadTasks();

    expect(res.failed).toBe(1);
    expect(ssh.execRemoteCommand).not.toHaveBeenCalled();
  });
});
