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
vi.mock("@/lib/downloads/redirect-chain", () => ({
  resolveDownloadRedirects: vi.fn(async (url: string) => ({ ok: true, url })),
  pinHttpSourceForAria2: vi.fn((url: string) => ({ uri: url, options: {} })),
}));
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
  buildDirectDownloadStopCommand: vi.fn(() => "STOP_CMD"),
  parseDirectDownloadStopResult: (result: { stdout: string; exitCode?: number | null }) =>
    result.exitCode === 0 && /^(STOPPED|NOT_RUNNING)$/m.test(result.stdout) ? result.stdout.trim() : null,
  getDirectDownloadLogCommand: vi.fn(() => "LOG_CMD"),
  shellQuote: (s: string) => `'${s}'`,
  toRemoteChildPath: (base: string, f: string) => `${base}/${f}`,
}));
vi.mock("@/lib/downloads/helpers", () => ({
  deriveDownloadFileNameFromUrl: (url: string) => new URL(url).pathname.split("/").filter(Boolean).pop() ?? null,
  indexDownloadedFileEntry: vi.fn(async () => undefined),
  getPublicDownloadError: vi.fn(() => "dl error"),
  buildProgressText: vi.fn(() => "progress"),
}));

const { executeAria2RelayDownload, executeDirectDownload } = await import("../execution");
const { resolveDownloadRedirects } = await import("@/lib/downloads/redirect-chain");
const { buildDirectDownloadCommand } = await import("@/lib/downloads/remote-command");

const server = {
  id: "srv-1",
  host: "h",
  port: 22,
  username: "u",
  operatingSystem: "LINUX",
  managementMode: "DIRECT",
  connectionType: "PASSWORD",
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
    expect(cleanupCall).toEqual(expect.objectContaining({ command: "STOP_CMD" }));
    expect(prismaMock.downloadTask.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: "task-5", status: "RUNNING" },
      data: expect.objectContaining({ status: "FAILED" }),
    }));
  });

  it("stops the remote download it just started when the task was cancelled during the spawn", async () => {
    ssh.execRemoteCommand
      .mockResolvedValueOnce({ stdout: "", exitCode: 0 }) // mkdir
      .mockResolvedValueOnce({ stdout: "4321", exitCode: 0 }) // spawn
      .mockResolvedValueOnce({ stdout: "STOPPED\n", exitCode: 0 }); // stop
    prismaMock.downloadTask.updateMany
      .mockResolvedValueOnce({ count: 1 }) // PENDING -> RUNNING claim
      .mockResolvedValueOnce({ count: 0 }); // pid record: the row is CANCELLED now
    const { indexDownloadedFileEntry } = await import("@/lib/downloads/helpers");

    await executeDirectDownload("task-6", server, "http://x/f", "/target", "f", undefined, {
      hostname: "x",
      address: "1.2.3.4",
      port: 443,
    });

    expect(ssh.execRemoteCommand).toHaveBeenCalledTimes(3);
    expect((ssh.execRemoteCommand.mock.calls as unknown[][])[2]?.[0]).toEqual(expect.objectContaining({ command: "STOP_CMD" }));
    expect(indexDownloadedFileEntry).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledTimes(2);
  });
});

describe("relayExceedsLimits", () => {
  it("holds each file to the per-file limit and all of them to the quota left", async () => {
    const { relayExceedsLimits } = await import("@/lib/downloads/execution");
    const files = [{ size: 40 }, { size: 50 }];
    expect(relayExceedsLimits(files, { maxFileBytes: null, remainingBytes: null })).toBe(false);
    expect(relayExceedsLimits(files, { maxFileBytes: BigInt(50), remainingBytes: BigInt(90) })).toBe(false);
    expect(relayExceedsLimits(files, { maxFileBytes: BigInt(45), remainingBytes: null })).toBe(true);
    expect(relayExceedsLimits(files, { maxFileBytes: null, remainingBytes: BigInt(89) })).toBe(true);
  });
});

describe("executeDirectDownload with a redirecting link", () => {
  const resolution = { hostname: "github.com", address: "140.82.112.3", port: 443 as const };

  it("hands curl the end of the checked redirect chain, named after the link the user gave", async () => {
    // curl runs with --max-redirs 0: a GitHub release asset (302 to a signed
    // CDN URL) failed with curl error 47 before the chain was resolved here.
    vi.mocked(resolveDownloadRedirects).mockResolvedValueOnce({
      ok: true,
      url: "https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sig=x",
      resolution: { hostname: "release-assets.githubusercontent.com", address: "185.199.108.133", port: 443 },
    });

    await executeDirectDownload("task-r1", server, "https://github.com/cli/cli/releases/download/v2.62.0/gh_2.62.0_checksums.txt", "/target", null, undefined, resolution);

    expect(buildDirectDownloadCommand).toHaveBeenCalledWith(expect.objectContaining({
      url: "https://release-assets.githubusercontent.com/github-production-release-asset/1/abc?sig=x",
      fileName: "gh_2.62.0_checksums.txt",
      sourceResolution: { hostname: "release-assets.githubusercontent.com", address: "185.199.108.133", port: 443 },
    }));
  });

  it("fails the task with the reason when a redirect target is refused, without a remote process", async () => {
    vi.mocked(resolveDownloadRedirects).mockResolvedValueOnce({ ok: false, reason: "Redirect target rejected: private address" });
    vi.mocked(buildDirectDownloadCommand).mockClear();

    await executeDirectDownload("task-r2", server, "https://example.com/file.zip", "/target", null, undefined, resolution);

    expect(buildDirectDownloadCommand).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith({
      where: { id: "task-r2", status: "RUNNING" },
      data: { status: "FAILED", errorMessage: "Redirect target rejected: private address" },
    });
  });
});
