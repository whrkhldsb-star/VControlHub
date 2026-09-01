import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the claim-before-side-effect ordering in the download
 * execute helpers. The durable download.execute job has maxAttempts=3 and the
 * worker re-dispatches a task it finds still RUNNING, so a retry / concurrent
 * tick MUST NOT (a) start a duplicate aria2 download or remote process, nor
 * (b) wipe the shared relay tempDir out from under the still-active first run.
 */

const prismaMock = {
  downloadTask: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
  },
};
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

const aria2 = {
  ensureAria2Daemon: vi.fn(async () => undefined),
  addUri: vi.fn(async () => "gid-new"),
  removeDownload: vi.fn(async () => undefined),
  tellStatus: vi.fn(async () => ({ status: "complete", completedLength: "0", totalLength: "0", downloadSpeed: "0" })),
  getPublicAria2Error: vi.fn(() => "aria2 error"),
};
vi.mock("@/lib/aria2/service", () => aria2);

const ssh = {
  execRemoteCommand: vi.fn(async () => ({ stdout: "4321", exitCode: 0 })),
  buildSshParamsFromServer: vi.fn(async () => ({ host: "h", port: 22, username: "u" })),
  connectSsh: vi.fn(),
  createVerifiedSshConfig: vi.fn(() => ({})),
};
vi.mock("@/lib/ssh/client", () => ssh);

const fsMock = {
  mkdir: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
  readdir: vi.fn(async () => [] as string[]),
  stat: vi.fn(async () => ({ size: 0 })),
};
vi.mock("fs/promises", () => ({ default: fsMock, ...fsMock }));
vi.mock("fs", () => ({ default: { createReadStream: vi.fn() }, createReadStream: vi.fn() }));

vi.mock("@/lib/notification/service", () => ({ notifyDownloadResult: vi.fn(async () => undefined) }));
vi.mock("@/lib/downloads/remote-command", () => ({
  buildDirectDownloadCommand: vi.fn(() => "DL_CMD"),
  getDirectDownloadLogCommand: vi.fn(() => "LOG_CMD"),
  shellQuote: (s: string) => `'${s}'`,
  toRemoteChildPath: (base: string, f: string) => `${base}/${f}`,
}));
vi.mock("@/lib/downloads/helpers", () => ({
  indexDownloadedFileEntry: vi.fn(async () => undefined),
  getPublicDownloadError: vi.fn(() => "dl error"),
  buildProgressText: vi.fn(() => "progress"),
}));

const { executeAria2RelayDownload, executeDirectDownload } = await import("../execution");

const server = {
  host: "h",
  port: 22,
  username: "u",
  sshKeyId: null,
  password: null,
  hostKeySha256: "ab",
  storageNode: { id: "node-1", basePath: "/data" },
  sshKey: { privateKey: "k" },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.downloadTask.findUnique.mockResolvedValue({ teamId: "team-1" });
  prismaMock.downloadTask.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.downloadTask.update.mockResolvedValue({});
  fsMock.readdir.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("executeAria2RelayDownload claim ordering", () => {
  it("does not start a duplicate download or wipe tempDir when the task is not resumable", async () => {
    // loadDownloadTeamId (1st findUnique) then the claim misses (count:0),
    // then the resume-lookup (2nd findUnique) reports a terminal task.
    prismaMock.downloadTask.findUnique
      .mockResolvedValueOnce({ teamId: "team-1" })
      .mockResolvedValueOnce({ status: "FAILED", aria2Gid: null });
    prismaMock.downloadTask.updateMany.mockResolvedValueOnce({ count: 0 });

    await executeAria2RelayDownload("task-1", server, ["http://x/f"], "/target");

    expect(aria2.addUri).not.toHaveBeenCalled();
    expect(fsMock.rm).not.toHaveBeenCalled(); // tempDir never wiped
    expect(fsMock.mkdir).not.toHaveBeenCalled();
  });

  it("claims PENDING->RUNNING before calling addUri on a fresh dispatch", async () => {
    vi.useFakeTimers();
    prismaMock.downloadTask.findUnique
      .mockResolvedValueOnce({ teamId: "team-1" }) // loadDownloadTeamId
      .mockResolvedValue({ status: "RUNNING" }); // in-loop status checks
    aria2.tellStatus.mockResolvedValue({ status: "complete", completedLength: "0", totalLength: "0", downloadSpeed: "0" });
    fsMock.readdir.mockResolvedValue([]); // completed but no file -> terminal, exits fast

    const p = executeAria2RelayDownload("task-2", server, ["http://x/f"], "/target");
    await vi.advanceTimersByTimeAsync(6000); // release the 5s poll sleep so the loop terminates
    await p;

    expect(aria2.addUri).toHaveBeenCalledTimes(1);
    const claimCall = prismaMock.downloadTask.updateMany.mock.calls[0]?.[0] as {
      where: { status: string };
      data: { status: string };
    };
    expect(claimCall.where.status).toBe("PENDING");
    expect(claimCall.data.status).toBe("RUNNING");
    // The claim (call 0) must precede addUri.
    const claimOrder = prismaMock.downloadTask.updateMany.mock.invocationCallOrder[0]!;
    const addUriOrder = aria2.addUri.mock.invocationCallOrder[0]!;
    expect(claimOrder).toBeLessThan(addUriOrder);
  });
});

describe("executeDirectDownload claim ordering", () => {
  it("does not spawn a remote process when the task is not PENDING", async () => {
    prismaMock.downloadTask.updateMany.mockResolvedValueOnce({ count: 0 }); // claim miss

    await executeDirectDownload("task-3", server, "http://x/f", "/target", null, undefined, {
      hostname: "x",
      address: "1.2.3.4",
      port: 443,
    });

    expect(ssh.execRemoteCommand).not.toHaveBeenCalled(); // no mkdir, no spawn
  });

  it("claims before spawning and records the pid on success", async () => {
    await executeDirectDownload("task-4", server, "http://x/f", "/target", null, undefined, {
      hostname: "x",
      address: "1.2.3.4",
      port: 443,
    });

    const claimCall = prismaMock.downloadTask.updateMany.mock.calls[0]?.[0] as {
      where: { status: string };
      data: { status: string };
    };
    expect(claimCall.where.status).toBe("PENDING");
    // The claim must precede the first remote command (mkdir/spawn).
    const claimOrder = prismaMock.downloadTask.updateMany.mock.invocationCallOrder[0]!;
    const firstExecOrder = ssh.execRemoteCommand.mock.invocationCallOrder[0]!;
    expect(claimOrder).toBeLessThan(firstExecOrder);
    // pid recorded via a RUNNING-guarded update.
    const pidUpdate = prismaMock.downloadTask.updateMany.mock.calls.find(
      (c) => (c[0] as { data: { pid?: number } }).data.pid === 4321,
    );
    expect(pidUpdate).toBeTruthy();
  });

  it("stops the detached remote process when local indexing fails", async () => {
    ssh.execRemoteCommand
      .mockResolvedValueOnce({ stdout: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "4321", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", exitCode: 0 });
    const { indexDownloadedFileEntry } = await import("@/lib/downloads/helpers");
    vi.mocked(indexDownloadedFileEntry).mockRejectedValueOnce(new Error("index unavailable"));

    await executeDirectDownload("task-5", server, "http://x/f", "/target", "f", undefined, {
      hostname: "x",
      address: "1.2.3.4",
      port: 443,
    });

    expect(ssh.execRemoteCommand).toHaveBeenCalledTimes(3);
    const cleanupCall = (ssh.execRemoteCommand.mock.calls as unknown[][])[2]?.[0];
    expect(cleanupCall).toEqual(expect.objectContaining({
      command: expect.stringContaining("kill"),
    }));
    expect(prismaMock.downloadTask.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "task-5", status: "RUNNING" },
      data: expect.objectContaining({ status: "FAILED" }),
    }));
  });
});
