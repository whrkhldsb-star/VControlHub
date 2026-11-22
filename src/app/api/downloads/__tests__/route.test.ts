import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageAccessDecision } from "@/lib/storage/access-control";
import { relayTempDir } from "@/lib/runtime/platform-paths";
import { directEndpointIdentity } from "@/lib/downloads/direct-identity";

const {
  lookupMock,
  requireSessionMock,
  sessionHasPermissionMock,
  assertStorageAccessMock,
  prismaMock,
  ensureAria2DaemonMock,
  addUriMock,
  removeDownloadMock,
  pauseDownloadMock,
  unpauseDownloadMock,
  tellActiveMock,
  tellWaitingMock,
  tellStatusMock,
  getGlobalStatMock,
  changeOptionMock,
  changeGlobalOptionMock,
  execRemoteCommandMock,
  buildSshParamsFromServerMock,
  auditUserActionMock,
  logErrorMock,
  execFileMock,
  mkdirMock,
  rmMock,
  writeFileMock,
  unlinkMock,
  chmodMock,
  readdirMock,
  statMock,
} = vi.hoisted(() => ({
  lookupMock: vi.fn(),
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn((_session?: unknown, _permission?: string) => true),
  assertStorageAccessMock: vi.fn<(input: { relativePath?: string | null }) => Promise<StorageAccessDecision>>(() => Promise.resolve({ allowed: true })),
  prismaMock: {
    userStorageAccess: { findMany: vi.fn() },
    $transaction: vi.fn(),
    server: { findUnique: vi.fn() },
    downloadTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      updateManyAndReturn: vi.fn(),
      deleteMany: vi.fn(),
      delete: vi.fn(),
    },
    job: { findFirst: vi.fn(), fields: { maxAttempts: "maxAttempts" } },
    fileEntry: {
      aggregate: vi.fn(),
      findFirst: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
  ensureAria2DaemonMock: vi.fn(),
  addUriMock: vi.fn(),
  removeDownloadMock: vi.fn(),
  pauseDownloadMock: vi.fn(),
  unpauseDownloadMock: vi.fn(),
  tellActiveMock: vi.fn(),
  tellWaitingMock: vi.fn(),
  tellStatusMock: vi.fn(),
  getGlobalStatMock: vi.fn(),
  changeOptionMock: vi.fn(),
  changeGlobalOptionMock: vi.fn(),
  execRemoteCommandMock: vi.fn(),
  buildSshParamsFromServerMock: vi.fn(),
  auditUserActionMock: vi.fn(),
  logErrorMock: vi.fn(),
  execFileMock: vi.fn(),
  mkdirMock: vi.fn(),
  rmMock: vi.fn(),
  writeFileMock: vi.fn(),
  unlinkMock: vi.fn(),
  chmodMock: vi.fn(),
  readdirMock: vi.fn(),
  statMock: vi.fn(),
}));

vi.mock("node:dns/promises", () => ({
  default: { lookup: lookupMock },
  lookup: lookupMock,
}));
vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
// Download scenarios share one URL and account; API throttling has its own
// suite and must not make later scenarios fail after 30 writes in this file.
vi.mock("@/lib/http/rate-limit-presets", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/http/rate-limit-presets")>(),
  withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
}));
vi.mock("@/lib/storage/access-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/access-control")>();
  return {
    STORAGE_ACCESS_DENIED_REASONS: actual.STORAGE_ACCESS_DENIED_REASONS,
    largestAllowedWrite: actual.largestAllowedWrite,
    assertStorageAccess: assertStorageAccessMock,
    releaseStorageQuotaGuard: vi.fn(async () => undefined),
  };
});
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logging", () => ({ logError: logErrorMock, createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: auditUserActionMock }));
vi.mock("@/lib/downloads/redirect-chain", () => ({
  resolveDownloadRedirects: vi.fn(async (url: string) => ({ ok: true, url })),
}));
vi.mock("@/lib/aria2/service", () => ({
  ensureAria2Daemon: ensureAria2DaemonMock,
  addUri: addUriMock,
  removeDownload: removeDownloadMock,
  pauseDownload: pauseDownloadMock,
  unpauseDownload: unpauseDownloadMock,
  tellActive: tellActiveMock,
  tellWaiting: tellWaitingMock,
  tellStatus: tellStatusMock,
  getGlobalStat: getGlobalStatMock,
  changeOption: changeOptionMock,
  changeGlobalOption: changeGlobalOptionMock,
  formatBytes: (bytes: string | number) => `${bytes} B`,
  formatSpeed: (bytes: string | number) => `${bytes} B/s`,
  computeProgress: () => 0,
}));
vi.mock("@/lib/ssh/client", () => ({
  resolveRemoteRealPath: vi.fn(async ({ remotePath }) => remotePath),
  execRemoteCommand: execRemoteCommandMock,
  buildSshParamsFromServer: buildSshParamsFromServerMock,
}));
vi.mock("child_process", () => ({
  default: { execFile: execFileMock },
  execFile: execFileMock,
}));
vi.mock("fs/promises", () => ({
  default: {
    mkdir: mkdirMock,
    rm: rmMock,
    writeFile: writeFileMock,
    unlink: unlinkMock,
    chmod: chmodMock,
    readdir: readdirMock,
    stat: statMock,
  },
  mkdir: mkdirMock,
  rm: rmMock,
  writeFile: writeFileMock,
  unlink: unlinkMock,
  chmod: chmodMock,
  readdir: readdirMock,
  stat: statMock,
}));

// TR-001 (T12): the route used to fire executeAria2RelayDownload /
// executeDirectDownload inline. Now it enqueues a `download.execute` job and
// the durable worker poll loop is responsible for the actual dispatch. The
// unit tests below still mock the aria2 + ssh + fs layers, so we mirror the
// old fire-and-forget behaviour with a test seam: enqueueDownloadExecutionJob
// is a no-op record and we synchronously kick off the real execute* helpers
// inside a microtask so the existing `vi.waitFor(() => expect(...))` assertions
// keep working without rewriting every test.
//
// New-A (2026-06-15): the route now `await`s the enqueue, so we expose
// enqueueDownloadExecutionJob as a regular `vi.fn(...)` that tests can flip
// into a rejecting mode (mockRejectedValueOnce) to exercise the rollback
// path. Each beforeEach() resets it to a successful default that still kicks
// off execute* in the background.
const { enqueueDownloadExecutionJobMock } = vi.hoisted(() => {
  // Body lives inside a hoisted factory so the vi.mock() below can reference
  // the mock by name even though both declarations are hoisted together —
  // vitest warns "Cannot access 'X' before initialization" if you put the
  // const in the module body and reference it from the mock factory.
  const successBody = async ({
    mode,
    taskId,
    sourceResolution,
  }: {
    mode: "aria2_relay" | "direct";
    taskId: string;
    userId?: string | null;
    sourceResolution?: { hostname: string; address: string; port: 80 | 443 };
  }) => {
    const { executeAria2RelayDownload, executeDirectDownload } = await import(
      "@/lib/downloads/execution"
    );
    const { prisma } = await import("@/lib/db");
    const task = await prisma.downloadTask.findUnique({
      where: { id: taskId },
      include: { server: { include: { sshKey: true, storageNode: true, agentFileShares: { select: { node: true } } } } },
    });
    // Build a DownloadServer shape that mirrors what the real worker (and
    // the old fire-and-forget route) would pass. The route-test mocks aria2
    // + ssh + fs at their module boundary, so the helper bodies run
    // happily and the existing `vi.waitFor(...)` assertions still see
    // the side effects.
    const serverForExec = task?.server
      ? {
          id: task.server.id,
          operatingSystem: "LINUX",
          managementMode: "DIRECT",
          connectionType: task.server.sshKeyId ? "SSH_KEY" : "PASSWORD",
          host: task.server.host,
          port: task.server.port,
          username: task.server.username,
          sshKeyId: task.server.sshKeyId,
          password: task.server.password,
          hostKeySha256: (task.server as { hostKeySha256?: string | null }).hostKeySha256 ?? null,
          storageNode: task.server.storageNode
            ? { id: task.server.storageNode.id, basePath: task.server.storageNode.basePath }
            : null,
          sshKey: task.server.sshKey?.privateKey
            ? { privateKey: task.server.sshKey.privateKey }
            : null,
        }
      : {
          id: "srv-fallback",
          operatingSystem: "LINUX",
          managementMode: "DIRECT",
          connectionType: "PASSWORD",
          host: "203.0.113.10",
          port: 22,
          username: "root",
          sshKeyId: null,
          password: null,
          storageNode: { id: "store_1", basePath: "/srv/cloud" },
          hostKeySha256: null,
          sshKey: null,
        };
    const fallbackUrl = "https://example.com/file.iso";
    const fallbackPath = "/srv/cloud/downloads";
    if (mode === "aria2_relay") {
      void executeAria2RelayDownload(
        taskId,
        serverForExec,
        [task?.url ?? fallbackUrl],
        task?.targetPath ?? fallbackPath,
        task?.fileName ?? null,
        task?.maxSpeedKb ?? null,
        task?.createdBy ?? undefined,
      ).catch(() => {});
    } else {
      void executeDirectDownload(
        taskId,
        serverForExec,
        task?.url ?? fallbackUrl,
        task?.targetPath ?? fallbackPath,
        task?.fileName ?? null,
        task?.createdBy ?? undefined,
        sourceResolution,
      ).catch(() => {});
    }
    return { id: `job-test-${taskId}`, type: "download.execute", status: "PENDING" };
  };
  return { enqueueDownloadExecutionJobMock: vi.fn(successBody) };
});

vi.mock("@/lib/downloads/execution-worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/downloads/execution-worker")>();
  return {
    ...actual,
    enqueueDownloadExecutionJob: enqueueDownloadExecutionJobMock,
    runDownloadExecutionJobWorkerOnce: vi.fn(async () => false),
    startDownloadJobWorker: vi.fn(async () => ({ started: true, running: false, timer: null })),
    stopDownloadJobWorkerForTests: vi.fn(),
  };
});

vi.mock("@/lib/server/team-access", () => ({
  assertServerTeamAccess: vi.fn(async () => ({ ok: true as const })),
}));

const session = { userId: "u_1", username: "alice", roles: ["admin"] as import("@/lib/auth/rbac").RoleKey[], currentTeamId: "team_1" as string | null, mustChangePassword: false };

vi.mock("@/lib/auth/require-api-permission", async () => {
  const { NextResponse } = await import("next/server");
  return {
    requireApiPermission: vi.fn(async (permission: string) => {
      // Delegate permission checks to the existing authorization mock.
      if (!sessionHasPermissionMock(session, permission)) {
        return NextResponse.json({ error: "Insufficient permissions" }, { status: 403 });
      }
      return { session };
    }),
  };
});

vi.mock("@/lib/auth/api-session", () => ({
  getApiSession: vi.fn(async () => session),
  requireApiSession: vi.fn(async () => session),
  isSessionPayload: (value: unknown) => Boolean(value) && typeof value === "object" && value !== null && "userId" in value,
}));

import { DELETE, GET, PATCH, POST } from "../route";

function request(body: unknown) {
  return new Request("https://example.com/api/downloads", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function serverFixture() {
  return {
    id: "srv_1",
    name: "node-1",
    host: "203.0.113.10",
    port: 22,
    username: "root",
    sshKeyId: "key_1",
    password: null,
    sshKey: { privateKey: "PRIVATE KEY" },
    storageNode: {
      id: "store_1",
      basePath: "/srv/cloud",
      driver: "SFTP",
      host: "203.0.113.10",
      port: 31888,
      directAccessMode: "DIRECT",
      publicBaseUrl: "https://files.example.com",
      directAccessExpiresSeconds: 300,
    },
  };
}


describe("/api/downloads", () => {
  beforeEach(() => {
    prismaMock.userStorageAccess.findMany.mockResolvedValue([]);
    prismaMock.fileEntry.aggregate.mockResolvedValue({ _sum: { size: BigInt(0) } });
    session.roles = ["admin"];
    // vi.clearAllMocks() only resets call history, not implementations —
    // but to keep behaviour tight we explicitly reset the two mocks that
    // the suite flips per-test (enqueue + the downloadTask.create default).
    vi.clearAllMocks();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    requireSessionMock.mockResolvedValue(session);
    // Prefer mockReset so mockImplementation from team-scope tests cannot leak.
    sessionHasPermissionMock.mockReset();
    sessionHasPermissionMock.mockReturnValue(true);
    assertStorageAccessMock.mockReset();
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
    prismaMock.$transaction.mockImplementation((work) => work(prismaMock));
    prismaMock.server.findUnique.mockResolvedValue(serverFixture());
    prismaMock.downloadTask.create.mockReset();
    prismaMock.downloadTask.create.mockResolvedValue({ id: "task_1" });
    prismaMock.downloadTask.findMany.mockReset();
    prismaMock.downloadTask.findFirst.mockReset();
    prismaMock.downloadTask.findUnique.mockReset();
    prismaMock.downloadTask.update.mockReset();
    prismaMock.downloadTask.updateMany.mockReset();
    prismaMock.downloadTask.delete.mockReset();
    prismaMock.downloadTask.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.fileEntry.findFirst.mockReset();
    prismaMock.fileEntry.createMany.mockReset().mockResolvedValue({ count: 1 });
    prismaMock.fileEntry.updateMany.mockReset().mockResolvedValue({ count: 1 });
    buildSshParamsFromServerMock.mockResolvedValue({ host: "203.0.113.10", port: 22, username: "root" });
    execRemoteCommandMock.mockResolvedValue({ stdout: "12345\n", stderr: "", exitCode: 0 });
    statMock.mockResolvedValue({ size: 1024 });
    // vi.clearAllMocks() also wipes the implementation we installed in the
    // vi.mock factory, so re-point the shared reference at the same body the
    // production module returns. New-A tests can still flip a single call
    // into a rejecting mode via enqueueDownloadExecutionJobMock.mockRejectedValueOnce().
    enqueueDownloadExecutionJobMock.mockReset();
    enqueueDownloadExecutionJobMock.mockImplementation(
      async ({ mode, taskId, sourceResolution }: { mode: "aria2_relay" | "direct"; taskId: string; userId?: string | null; sourceResolution?: { hostname: string; address: string; port: 80 | 443 } }) => {
        const { executeAria2RelayDownload, executeDirectDownload } = await import(
          "@/lib/downloads/execution"
        );
        const { prisma } = await import("@/lib/db");
        const task = await prisma.downloadTask.findUnique({
          where: { id: taskId },
          include: { server: { include: { sshKey: true, storageNode: true, agentFileShares: { select: { node: true } } } } },
        });
        const serverForExec = task?.server
          ? {
              id: task.server.id,
              operatingSystem: "LINUX",
              managementMode: "DIRECT",
              connectionType: task.server.sshKeyId ? "SSH_KEY" : "PASSWORD",
              host: task.server.host,
              port: task.server.port,
              username: task.server.username,
              sshKeyId: task.server.sshKeyId,
              password: task.server.password,
              hostKeySha256: (task.server as { hostKeySha256?: string | null }).hostKeySha256 ?? null,
              storageNode: task.server.storageNode
                ? { id: task.server.storageNode.id, basePath: task.server.storageNode.basePath }
                : null,
              sshKey: task.server.sshKey?.privateKey
                ? { privateKey: task.server.sshKey.privateKey }
                : null,
            }
          : {
              id: "srv-fallback",
              operatingSystem: "LINUX",
              managementMode: "DIRECT",
              connectionType: "PASSWORD",
              host: "203.0.113.10",
              port: 22,
              username: "root",
              sshKeyId: null,
              password: null,
              storageNode: { id: "store_1", basePath: "/srv/cloud" },
              hostKeySha256: null,
              sshKey: null,
            };
        const fallbackUrl = "https://example.com/file.iso";
        const fallbackPath = "/srv/cloud/downloads";
        if (mode === "aria2_relay") {
          void executeAria2RelayDownload(
            taskId,
            serverForExec,
            [task?.url ?? fallbackUrl],
            task?.targetPath ?? fallbackPath,
            task?.fileName ?? null,
            task?.maxSpeedKb ?? null,
            task?.createdBy ?? undefined,
          ).catch(() => {});
        } else {
          void executeDirectDownload(
            taskId,
            serverForExec,
            task?.url ?? fallbackUrl,
            task?.targetPath ?? fallbackPath,
            task?.fileName ?? null,
            task?.createdBy ?? undefined,
            sourceResolution,
          ).catch(() => {});
        }
        return { id: `job-test-${taskId}`, type: "download.execute", status: "PENDING" };
      },
    );
  });

  it("rejects unsafe custom file names before creating a task", async () => {
    const response = await POST(request({
      url: "https://example.com/file.iso",
      serverId: "srv_1",
      targetPath: "/srv/cloud/downloads",
      fileName: "../evil.iso",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/filename|name|path|文件名|路径/i) });
    expect(prismaMock.downloadTask.create).not.toHaveBeenCalled();
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("rejects download URLs whose DNS resolves to private or metadata addresses before storage or remote side effects", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);

    const response = await POST(request({
      url: "https://evil.example/file.iso",
      serverId: "srv_1",
      targetPath: "/srv/cloud/downloads",
      fileName: "file.iso",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "The download link's host resolves to a private, loopback or link-local address" });
    expect(lookupMock).toHaveBeenCalledWith("evil.example", { all: true, verbatim: true });
    expect(prismaMock.server.findUnique).not.toHaveBeenCalled();
    expect(assertStorageAccessMock).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.create).not.toHaveBeenCalled();
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("checks storage path grants before creating a download task", async () => {
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "没有此存储节点或路径的访问授权" });

    const response = await POST(request({
      url: "https://example.com/file.iso",
      serverId: "srv_1",
      targetPath: "private",
      fileName: "file.iso",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "没有此存储节点或路径的访问授权" });
    expect(assertStorageAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      session,
      storageNodeId: "store_1",
      relativePath: "private",
      operation: "write",
    }));
    expect(prismaMock.downloadTask.create).not.toHaveBeenCalled();
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("admits a known replacement at full quota while retaining the independent file limit", async () => {
    session.roles = ["operator"];
    sessionHasPermissionMock.mockImplementation((_s, permission) => permission === "storage:write");
    prismaMock.userStorageAccess.findMany.mockResolvedValue([{ pathPrefix: "", canWrite: true, quotaBytes: BigInt(50), maxFileBytes: BigInt(16) }]);
    prismaMock.fileEntry.aggregate.mockResolvedValue({ _sum: { size: BigInt(50) } });
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce({ size: BigInt(20) });
    const { downloadWriteCapacity } = await import("@/lib/downloads/write-capacity");
    const { largestAllowedWrite } = await import("@/lib/storage/access-control");
    const capacity = await downloadWriteCapacity({ session, storageNodeId: "store_1", relativePath: "downloads" }, "app.iso");
    expect(capacity.remainingBytes).toBe(BigInt(20));
    expect(largestAllowedWrite(capacity)).toBe(BigInt(16));
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce({ size: BigInt(20) });
    const response = await POST(request({ url: "https://example.com/app.iso", serverId: "srv_1", targetPath: "downloads", fileName: "app.iso" }));
    expect(response.ok).toBe(true);
    expect(prismaMock.downloadTask.create).toHaveBeenCalledOnce();
  });

  it("refuses a remote download into a folder whose quota is used up, before creating a task", async () => {
    session.roles = ["operator"];
    sessionHasPermissionMock.mockImplementation((_s, permission) => permission === "storage:write");
    prismaMock.userStorageAccess.findMany.mockResolvedValue([{ pathPrefix: "downloads", canWrite: true, quotaBytes: BigInt(50), maxFileBytes: BigInt(1000) }]);
    prismaMock.fileEntry.aggregate.mockResolvedValue({ _sum: { size: BigInt(50) } });

    const response = await POST(request({
      url: "https://example.com/releases/app.iso",
      serverId: "srv_1",
      targetPath: "downloads",
      fileName: "app.iso",
    }));

    expect(response.status).toBe(403);
    expect(prismaMock.downloadTask.create).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.aggregate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ storageNodeId: "store_1", OR: expect.arrayContaining([{ relativePath: "downloads" }]) }) }));
  });

  it("records the pid and leaves the file index untouched until the direct download completes", async () => {
    prismaMock.downloadTask.create.mockResolvedValueOnce({ id: "task_direct" });
    // TR-001 (T12): the route now enqueues a durable `download.execute` job
    // and the test seam in this file looks the task row back up to dispatch
    // the real executeDirectDownload helper. Provide the row the seam needs
    // to record the chosen file name and pid.
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
      id: "task_direct",
      url: "https://example.com/releases/app.iso",
      targetPath: "/srv/cloud/downloads",
      fileName: "app.iso",
      relayMode: false,
      maxSpeedKb: null,
      createdBy: "u_1",
    });
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);

    const response = await POST(request({
      url: "https://example.com/releases/app.iso",
      serverId: "srv_1",
      targetPath: "downloads",
      fileName: "app.iso",
    }));

    expect(response.status).toBe(200);
    expect(prismaMock.downloadTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ directStorageNodeId: "store_1" }),
    }));
    // Claim now happens BEFORE the remote spawn (PENDING -> RUNNING), and the
    // pid is recorded on a second RUNNING-guarded update once the process is up.
    // This ordering prevents a retry/concurrent tick from launching a duplicate
    // remote downloader before the CAS could reject it.
    await vi.waitFor(() => expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "task_direct", status: "PENDING" }),
      data: expect.objectContaining({ status: "RUNNING" }),
    })));
    await vi.waitFor(() => expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_direct", status: "RUNNING" },
      // The progress text is translated now (A5); the pid is what this step records.
      data: expect.objectContaining({ pid: 12345, progress: expect.any(String) }),
    })));
    expect(prismaMock.fileEntry.createMany).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  it("creates one independent task per URL for an HTTP/HTTPS batch", async () => {
    prismaMock.downloadTask.create
      .mockResolvedValueOnce({ id: "task_batch_1" })
      .mockResolvedValueOnce({ id: "task_batch_2" });

    const response = await POST(request({
      url: "https://example.com/one.iso",
      serverId: "srv_1",
      targetPath: "downloads",
      isBatch: true,
      batchUrls: ["https://example.com/one.iso", "https://example.com/two.iso"],
    }));

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ success: true, count: 2 });
    expect(payload.taskIds).toEqual(["task_batch_1", "task_batch_2"]);
    expect(prismaMock.downloadTask.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.downloadTask.create).toHaveBeenNthCalledWith(1, expect.objectContaining({
      data: expect.objectContaining({ url: "https://example.com/one.iso" }),
    }));
    expect(prismaMock.downloadTask.create).toHaveBeenNthCalledWith(2, expect.objectContaining({
      data: expect.objectContaining({ url: "https://example.com/two.iso" }),
    }));
  });

  it("rejects a batch that mixes magnet links with HTTP URLs", async () => {
    const response = await POST(request({
      url: "https://example.com/one.iso",
      serverId: "srv_1",
      targetPath: "downloads",
      isBatch: true,
      batchUrls: ["https://example.com/one.iso", "magnet:?xt=urn:btih:abc123"],
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("磁力") });
    expect(prismaMock.downloadTask.create).not.toHaveBeenCalled();
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("filters download list to currently readable storage targets", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      {
        id: "owned_task",
        createdBy: "u_1",
        status: "RUNNING",
        targetPath: "/srv/cloud/own/file.iso",
        server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } },
        creator: { id: "u_1", username: "alice", displayName: null },
        aria2Gid: null,
        pid: 12345,
        category: null,
        maxSpeedKb: null,
        totalBytes: null,
        completedBytes: null,
        downloadSpeed: null,
        fileSize: null,
        isBatch: false,
        batchUrls: null,
      },
      {
        id: "shared_task",
        createdBy: "u_2",
        status: "RUNNING",
        targetPath: "/srv/cloud/shared/file.iso",
        server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } },
        creator: { id: "u_2", username: "bob", displayName: null },
        aria2Gid: null,
        pid: 23456,
        category: null,
        maxSpeedKb: null,
        totalBytes: null,
        completedBytes: null,
        downloadSpeed: null,
        fileSize: null,
        isBatch: false,
        batchUrls: null,
      },
      {
        id: "private_task",
        createdBy: "u_3",
        status: "RUNNING",
        targetPath: "/srv/cloud/private/file.iso",
        server: null,
        creator: { id: "u_3", username: "carol", displayName: null },
        aria2Gid: "gid_private",
        pid: null,
        category: null,
        maxSpeedKb: null,
        totalBytes: null,
        completedBytes: null,
        downloadSpeed: null,
        fileSize: null,
        isBatch: false,
        batchUrls: null,
      },
    ]);
    assertStorageAccessMock.mockImplementation(async () => ({ allowed: true }));

    const response = await GET(new Request("https://example.com/api/downloads"));

    expect(response.status).toBe(200);
    // The selected customer scopes both the task and its server.
    expect(prismaMock.downloadTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { teamId: "team_1", server: { teamId: "team_1", team: { deletedAt: null } } },
      orderBy: [ { createdAt: "desc" }, { id: "desc" }],
      take: 101,
    }));
    const body = await response.json();
    expect(body.tasks.map((task: { id: string }) => task.id)).toEqual(["owned_task", "shared_task"]);
    expect(tellStatusMock).not.toHaveBeenCalledWith("gid_private");
    expect(assertStorageAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      session,
      storageNodeId: "store_1",
      relativePath: "shared/file.iso",
      operation: "read",
    }));
    assertStorageAccessMock.mockReset();
    assertStorageAccessMock.mockResolvedValue({ allowed: true });
  });

  it("prefilters download list with teamWhere for non-admin sessions", async () => {
    session.roles = ["viewer"];
    sessionHasPermissionMock.mockImplementation((_sess, permission) => permission !== "team:manage");
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([]);

    const response = await GET(new Request("https://example.com/api/downloads?serverId=srv_1&category=iso&status=FAILED&cursor=task_cursor"));
    expect(response.status).toBe(200);
    expect(prismaMock.downloadTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        teamId: "team_1",
        server: expect.objectContaining({ AND: expect.any(Array) }),
        serverId: "srv_1",
        category: "iso",
        status: "FAILED",
      },
      take: 101,
      cursor: { id: "task_cursor" },
      skip: 1,
    }));
  });

  it("scans beyond hidden tasks and returns a cursor from the visible page", async () => {
    session.roles = ["viewer"];
    const server = serverFixture();
    const row = (id: string, targetPath: string) => ({ id, createdBy: "u_1", status: "FAILED", url: "https://example.test/file", server, targetPath });
    const visible = Array.from({ length: 99 }, (_, i) => row("readable-" + i, "/srv/cloud/public"));
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([...visible, row("private-1", "/srv/cloud/private"), row("private-2", "/srv/cloud/private")])
      .mockResolvedValueOnce([row("boundary", "/srv/cloud/public"), row("next", "/srv/cloud/public")]);
    assertStorageAccessMock.mockImplementation(async ({ relativePath }) => relativePath === "public" ? { allowed: true } : { allowed: false, reason: "no_access" });
    const response = await GET(new Request("https://example.com/api/downloads"));
    const body = await response.json();
    expect(body.tasks).toHaveLength(100);
    expect(body.nextCursor).toBe("boundary");
    expect(JSON.stringify(body)).not.toContain("private-");
  });

  it("stamps teamId from session on create", async () => {
    sessionHasPermissionMock.mockReturnValue(true);
    prismaMock.downloadTask.create.mockResolvedValueOnce({ id: "task_team" });
    const response = await POST(request({
      url: "https://example.com/file.iso",
      serverId: "srv_1",
      targetPath: "downloads",
    }));
    expect(response.status).toBe(200);
    expect(prismaMock.downloadTask.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        teamId: "team_1",
        createdBy: "u_1",
        url: "https://example.com/file.iso",
      }),
    }));
  });

  // A download lands on one server: in the all-customers view it is recorded under that server's customer,
  // where it used to be refused until a customer was chosen in the sidebar.
  it("records a download made in the all-customers view under the target server's customer", async () => {
    session.currentTeamId = null;
    try {
      prismaMock.server.findUnique.mockResolvedValue({ ...serverFixture(), teamId: "team_7" });
      prismaMock.downloadTask.create.mockResolvedValueOnce({ id: "task_follow" });
      const response = await POST(request({ url: "https://example.com/file.iso", serverId: "srv_1", targetPath: "downloads" }));
      expect(response.status).toBe(200);
      expect(prismaMock.downloadTask.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ teamId: "team_7" }) }));
      expect(enqueueDownloadExecutionJobMock).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team_7" }), prismaMock);

      // A server that belongs to no customer still needs one chosen.
      prismaMock.downloadTask.create.mockClear();
      prismaMock.server.findUnique.mockResolvedValue({ ...serverFixture(), teamId: null });
      const refused = await POST(request({ url: "https://example.com/file.iso", serverId: "srv_1", targetPath: "downloads" }));
      expect(refused.status).toBe(403);
      expect(prismaMock.downloadTask.create).not.toHaveBeenCalled();
    } finally {
      session.currentTeamId = "team_1";
    }
  });

  it("returns 404 for cross-team task control (teamAccessFilter)", async () => {
    session.roles = ["viewer"];
    sessionHasPermissionMock.mockImplementation((_sess, permission) => permission !== "team:manage");
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce(null);

    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ taskId: "other_team_task", action: "pause" }),
    }));
    expect(response.status).toBe(404);
    expect(prismaMock.downloadTask.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "other_team_task",
        server: expect.objectContaining({ AND: expect.any(Array) }),
        teamId: "team_1",
      },
    }));
  });

  it("exposes completed download files through the storage direct/proxy policy route", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      {
        id: "completed_task",
        createdBy: "u_1",
        url: "https://example.com/file.iso",
        status: "COMPLETED",
        targetPath: "/srv/cloud/downloads",
        fileName: "file.iso",
        relayMode: false,
        server: { ...serverFixture() },
        creator: { id: "u_1", username: "alice", displayName: null },
        aria2Gid: null,
        pid: 12345,
        category: null,
        maxSpeedKb: null,
        totalBytes: "2048",
        completedBytes: "2048",
        downloadSpeed: "0",
        fileSize: "2048",
        isBatch: false,
        batchUrls: null,
      },
    ]);

    const response = await GET(new Request("https://example.com/api/downloads"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      tasks: [
        {
          id: "completed_task",
          downloadAccess: {
            mode: "direct-url",
            transport: "direct",
            href: "/api/storage/direct-access?nodeId=store_1&path=downloads%2Ffile.iso&download=1",
            fallbackHref: "/api/storage/sftp-download?nodeId=store_1&path=downloads%2Ffile.iso&download=1",
            label: "下载文件",
            statusLabel: "当前：直连",
          },
        },
      ],
    });
  });

  it("does not start or query aria2 when listing direct-only tasks", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      { id: "task_direct", createdBy: "u_1", status: "RUNNING", targetPath: "/srv/cloud/downloads/file.iso", server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } }, aria2Gid: null, pid: 12345, category: null, maxSpeedKb: null, totalBytes: null, completedBytes: null, downloadSpeed: null, fileSize: null, isBatch: false, batchUrls: null },
    ]);

    const response = await GET(new Request("https://example.com/api/downloads"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ globalStat: null });
    expect(ensureAria2DaemonMock).not.toHaveBeenCalled();
    expect(tellStatusMock).not.toHaveBeenCalled();
    expect(getGlobalStatMock).not.toHaveBeenCalled();
  });

  it("keeps a completed aria2 relay running until transfer to the target VPS finishes", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      { id: "task_relay", createdBy: "u_1", targetPath: "/srv/cloud/downloads/file.iso", server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } }, status: "RUNNING", aria2Gid: "gid_1", pid: null, category: null, maxSpeedKb: null, totalBytes: null, completedBytes: null, downloadSpeed: null, fileSize: null, isBatch: false, batchUrls: null },
    ]);
    tellStatusMock.mockResolvedValueOnce({ gid: "gid_1", status: "complete", completedLength: "100", totalLength: "100", downloadSpeed: "0" });
    getGlobalStatMock.mockResolvedValueOnce({ downloadSpeed: "0" });

    const response = await GET(new Request("https://example.com/api/downloads"));

    expect(response.status).toBe(200);
    expect(ensureAria2DaemonMock).toHaveBeenCalledOnce();
    expect(tellStatusMock).toHaveBeenCalledWith("gid_1");
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "task_relay", status: "RUNNING", aria2Gid: "gid_1" }),
      data: expect.not.objectContaining({ status: "COMPLETED" }),
    }));
    expect(getGlobalStatMock).toHaveBeenCalledOnce();
  });

  it("keeps the original pause deadline and metadata gid when listing a legacy paused task", async () => {
    const updatedAt = new Date("2025-04-01T02:00:00Z");
    const metadataGid = "0123456789abcdef";
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([{
      id: "paused-legacy", createdBy: "u_1", targetPath: "/srv/cloud/downloads", server: serverFixture(),
      status: "PENDING", aria2Gid: "gid", transferManifest: { metadataGid }, updatedAt,
    }]);
    tellStatusMock.mockResolvedValueOnce({ gid: "gid", status: "paused", completedLength: "10", totalLength: "20", downloadSpeed: "0" });
    const response = await GET(new Request("https://example.com/api/downloads"));
    expect(response.status).toBe(200);
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith({
      where: { id: "paused-legacy", status: "PENDING", aria2Gid: "gid", updatedAt },
      data: expect.objectContaining({ transferManifest: { metadataGid, pausedUntil: updatedAt.getTime() + 24 * 3600_000 } }),
    });
  });

  it("leaves a download cancelled while aria2 answered as cancelled", async () => {
    // Listed as RUNNING, cancelled before aria2 replied "removed": the list
    // wrote FAILED over the committed cancel and showed it.
    const task = { id: "task_cancelled", createdBy: "u_1", targetPath: "/srv/cloud/downloads/file.iso", server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } }, status: "RUNNING", aria2Gid: "gid_3", pid: null, category: null, maxSpeedKb: null, totalBytes: null, completedBytes: null, downloadSpeed: null, fileSize: null, isBatch: false, batchUrls: null };
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([task]);
    tellStatusMock.mockResolvedValueOnce({ gid: "gid_3", status: "removed", completedLength: "10", totalLength: "200", downloadSpeed: "0" });
    getGlobalStatMock.mockResolvedValueOnce({ downloadSpeed: "0" });
    // The guarded write finds the task no longer active.
    prismaMock.downloadTask.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({ ...task, status: "CANCELLED", errorMessage: null });

    const response = await GET(new Request("https://example.com/api/downloads"));

    expect(prismaMock.downloadTask.update).not.toHaveBeenCalled();
    const listed = ((await response.json()) as { tasks: Array<{ id: string; status: string }> }).tasks.find((row) => row.id === "task_cancelled");
    expect(listed).toMatchObject({ status: "CANCELLED" });
  });

  it("stores aria2 byte counts as the strings the columns hold, and shows only what was stored", async () => {
    // Numbers were refused by Prisma on every poll ("Expected String,
    // provided Int"); the list still showed the new state as if stored.
    const task = { id: "task_gone", createdBy: "u_1", targetPath: "/srv/cloud/downloads/file.iso", server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } }, status: "RUNNING", aria2Gid: "gid_2", pid: null, category: null, maxSpeedKb: null, totalBytes: null, completedBytes: null, downloadSpeed: null, fileSize: null, isBatch: false, batchUrls: null };
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([task]);
    tellStatusMock.mockResolvedValueOnce({ gid: "gid_2", status: "removed", completedLength: "100", totalLength: "200", downloadSpeed: "0" });
    getGlobalStatMock.mockResolvedValueOnce({ downloadSpeed: "0" });
    prismaMock.downloadTask.updateMany.mockResolvedValueOnce({ count: 1 });

    const response = await GET(new Request("https://example.com/api/downloads"));

    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "task_gone", status: "RUNNING", aria2Gid: "gid_2" }),
      data: expect.objectContaining({ status: "FAILED", completedBytes: "100", totalBytes: "200", downloadSpeed: "0" }),
    });
    const listed = ((await response.json()) as { tasks: Array<{ id: string; status: string; completedBytes: string | null }> }).tasks.find((row) => row.id === "task_gone");
    expect(listed).toMatchObject({ status: "FAILED", completedBytes: "100" });

    // A refused write leaves the list showing what the database still says.
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([task]);
    tellStatusMock.mockResolvedValueOnce({ gid: "gid_2", status: "removed", completedLength: "100", totalLength: "200", downloadSpeed: "0" });
    getGlobalStatMock.mockResolvedValueOnce({ downloadSpeed: "0" });
    prismaMock.downloadTask.updateMany.mockRejectedValueOnce(new Error("write refused"));
    const again = await (await GET(new Request("https://example.com/api/downloads"))).json() as { tasks: Array<{ id: string; status: string }> };
    expect(again.tasks.find((row) => row.id === "task_gone")?.status).toBe("RUNNING");
  });

  it("refreshes a completed direct download from the remote process exit state", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_direct",
      createdBy: "u_1",
      url: "https://example.com/file.iso",
      status: "RUNNING",
      progress: "下载中…",
      pid: 12345,
      aria2Gid: null,
      relayMode: false,
      targetPath: "/srv/cloud/downloads",
      fileName: "file.iso",
      server: serverFixture(),
    });
    execRemoteCommandMock.mockResolvedValueOnce({ stdout: "COMPLETED\n2048\n", stderr: "", exitCode: 0 });
    prismaMock.downloadTask.updateMany.mockResolvedValueOnce({ count: 1 });

    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ taskId: "task_direct", action: "refresh" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "COMPLETED",
      progress: "下载完成",
      fileSize: "2048",
      totalBytes: "2048",
      completedBytes: "2048",
      downloadAccess: {
        mode: "direct-url",
        transport: "direct",
        href: "/api/storage/direct-access?nodeId=store_1&path=downloads%2Ffile.iso&download=1",
        fallbackHref: "/api/storage/sftp-download?nodeId=store_1&path=downloads%2Ffile.iso&download=1",
        label: "下载文件",
        statusLabel: "当前：直连",
      },
    });
    expect(execRemoteCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.stringContaining("app-dl-task_direct.pid.exit"),
    }));
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_direct", status: { in: ["PENDING", "RUNNING"] } },
      data: expect.objectContaining({
        status: "COMPLETED",
        progress: "下载完成",
        fileSize: "2048",
        totalBytes: "2048",
        completedBytes: "2048",
      }),
    }));
  });

  it("a direct refresh that answers after a cancel keeps the cancel", async () => {
    // The probe took a while; the task was cancelled meanwhile. Its late
    // COMPLETED used to overwrite CANCELLED and index the file.
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_direct",
      createdBy: "u_1",
      url: "https://example.com/file.iso",
      status: "RUNNING",
      progress: "下载中…",
      pid: 12345,
      aria2Gid: null,
      relayMode: false,
      targetPath: "/srv/cloud/downloads",
      fileName: "file.iso",
      server: serverFixture(),
    });
    execRemoteCommandMock.mockResolvedValueOnce({ stdout: "COMPLETED\n2048\n", stderr: "", exitCode: 0 });
    prismaMock.downloadTask.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({ status: "CANCELLED", progress: "已取消" });

    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ taskId: "task_direct", action: "refresh" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "CANCELLED", progress: "已取消" });
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.createMany).not.toHaveBeenCalled();
    expect(prismaMock.fileEntry.updateMany).not.toHaveBeenCalled();
  });

  it("leaves a finished relay task as it is on refresh, pause or resume", async () => {
    // aria2 still knows the gid and reports it "complete": that once turned a
    // COMPLETED task back into RUNNING.
    const finished = {
      id: "task_done", createdBy: "u_1", status: "COMPLETED", progress: "Download and transfer completed",
      url: "https://example.com/file.iso", fileName: "file.iso", relayMode: true, aria2Gid: "gid_done",
      targetPath: "/srv/cloud/downloads", server: { ...serverFixture() },
    };
    const patch = (action: string) => PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ taskId: "task_done", action }),
    }));
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce(finished);
    const refreshed = await patch("refresh");
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({ status: "COMPLETED" });
    for (const action of ["pause", "resume"]) {
      prismaMock.downloadTask.findFirst.mockResolvedValueOnce(finished);
      expect((await patch(action)).status).toBe(409);
    }
    expect(tellStatusMock).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled();
  });

  it("returns aria2 refresh byte counters so the Downloads page can update immediately", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_relay",
      createdBy: "u_1",
      status: "RUNNING",
      progress: "下载中",
      url: "https://example.com/file.iso",
      fileName: "file.iso",
      relayMode: true,
      aria2Gid: "gid_1",
      targetPath: "/srv/cloud/downloads",
      server: { ...serverFixture() },
    });
    tellStatusMock.mockResolvedValueOnce({
      gid: "gid_1",
      status: "complete",
      completedLength: "4096",
      totalLength: "4096",
      downloadSpeed: "0",
    });

    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ taskId: "task_relay", action: "refresh" }),
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "RUNNING",
      progress: "下载完成，正在传输到目标 VPS…",
      completedBytes: "4096",
      totalBytes: "4096",
      downloadSpeed: "0",
      downloadAccess: null,
    });
    // Written only while the task is still in progress.
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "task_relay", status: "RUNNING", aria2Gid: "gid_1" }),
      data: expect.objectContaining({
        status: "RUNNING",
        completedBytes: "4096",
        totalBytes: "4096",
        downloadSpeed: "0",
      }),
    }));
  });

  it("forbids the creator from controlling a task after losing storage write access", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_private",
      createdBy: session.userId,
      status: "RUNNING",
      aria2Gid: "gid_1",
      progress: "下载中",
      targetPath: "/srv/cloud/private/file.iso",
      server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "没有此存储节点或路径的访问授权" });

    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ taskId: "task_private", action: "pause" }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "没有该下载任务的控制权限" });
    expect(assertStorageAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      session,
      storageNodeId: "store_1",
      relativePath: "private/file.iso",
      operation: "write",
    }));
    expect(pauseDownloadMock).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalled();
  });

  it("forbids cross-user task cancellation when storage delete access is absent", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_private",
      createdBy: "u_2",
      url: "https://example.com/file.iso",
      status: "RUNNING",
      pid: null,
      aria2Gid: "gid_1",
      relayMode: true,
      targetPath: "/srv/cloud/private/file.iso",
      server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "没有此存储节点或路径的访问授权" });

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_private", { method: "DELETE" }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "没有该下载任务的取消权限" });
    expect(assertStorageAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      session,
      storageNodeId: "store_1",
      relativePath: "private/file.iso",
      operation: "delete",
    }));
    expect(removeDownloadMock).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalled();
  });


  it.each([-1, 1.5, 10_000_001])("rejects invalid download speed %s before any side effects", async (speed) => {
    const created = await POST(request({
      url: "https://example.com/file.iso", serverId: "srv_1",
      targetPath: "/srv/cloud/downloads", maxSpeedKb: speed,
    }));
    expect(created.status).toBe(400);
    for (const body of [{ taskId: "task_1", maxSpeedKb: speed }, { globalMaxSpeedKb: speed }]) {
      const updated = await PATCH(new Request("https://example.com/api/downloads", {
        method: "PATCH", body: JSON.stringify(body),
      }));
      expect(updated.status).toBe(400);
    }
    expect(prismaMock.downloadTask.create).not.toHaveBeenCalled();
    expect(changeOptionMock).not.toHaveBeenCalled();
    expect(changeGlobalOptionMock).not.toHaveBeenCalled();
  });

  it("requires storage node management permission for global download speed limits", async () => {
    sessionHasPermissionMock
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);

    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ globalMaxSpeedKb: 128 }),
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "缺少全局下载限速管理权限" });
    expect(changeGlobalOptionMock).not.toHaveBeenCalled();
  });

  it("leaves the process-wide aria2 limit and totals to the platform administrator", async () => {
    // One daemon serves every customer: a customer's administrator holds storage:manage-node (every permission
    // here is granted) but is not the platform administrator.
    session.roles = ["operator"];

    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ globalMaxSpeedKb: 1 }),
    }));
    expect(response.status).toBe(403);
    expect(changeGlobalOptionMock).not.toHaveBeenCalled();

    prismaMock.downloadTask.findMany.mockReset();
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      { id: "task_relay", createdBy: "u_1", targetPath: "/srv/cloud/downloads/file.iso", server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } }, status: "RUNNING", aria2Gid: "gid_1", pid: null, category: null, maxSpeedKb: null, totalBytes: null, completedBytes: null, downloadSpeed: null, fileSize: null, isBatch: false, batchUrls: null },
    ]);
    tellStatusMock.mockResolvedValueOnce({ gid: "gid_1", status: "active", completedLength: "10", totalLength: "100", downloadSpeed: "5" });
    const listed = await GET(new Request("https://example.com/api/downloads"));
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({ globalStat: null });
    expect(getGlobalStatMock).not.toHaveBeenCalled();
  });

  it("does not mark an aria2 task paused when the real pause operation fails", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_relay",
      createdBy: "u_1",
      server: serverFixture(),
      targetPath: "/srv/cloud/downloads/file.iso",
      status: "RUNNING",
      aria2Gid: "gid_1",
      progress: "下载中",
    });
    pauseDownloadMock.mockRejectedValueOnce(new Error("aria2 unavailable"));

    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ taskId: "task_relay", action: "pause" }),
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "暂停下载失败，远端任务状态未改变" });
    expect(pauseDownloadMock).toHaveBeenCalledWith("gid_1");
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled();
  });

  it("keeps the metadata gid when pausing the torrent content", async () => {
    const receipt = { metadataGid: "1234567890abcdef" };
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "torrent", createdBy: "u_1", server: serverFixture(), targetPath: "/srv/cloud/downloads",
      status: "RUNNING", aria2Gid: "1111111111111111", transferManifest: receipt,
    });
    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH", body: JSON.stringify({ taskId: "torrent", action: "pause" }),
    }));
    expect(response.status).toBe(200);
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith({
      where: { id: "torrent", status: "RUNNING", aria2Gid: "1111111111111111", transferManifest: { equals: receipt } },
      data: expect.objectContaining({ status: "PENDING", transferManifest: { ...receipt, pausedUntil: expect.any(Number) } }),
    });
  });

  it("pauses the content GID even when the worker commits the same handoff during the RPC", async () => {
    const meta = "1234567890abcdef", content = "1111111111111111";
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({ id: "torrent", createdBy: "u_1", url: "magnet:?dn=fixture", server: serverFixture(),
      targetPath: "/srv/cloud/downloads", status: "RUNNING", aria2Gid: meta, transferManifest: { phase: "dispatched" } });
    tellStatusMock.mockResolvedValueOnce({ status: "complete", followedBy: [content] }).mockResolvedValueOnce({ status: "active" });
    prismaMock.downloadTask.updateMany.mockResolvedValueOnce({ count: 0 });
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({ status: "RUNNING", aria2Gid: content, transferManifest: { metadataGid: meta } });
    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH", body: JSON.stringify({ taskId: "torrent", action: "pause" }),
    }));
    expect(response.status).toBe(200);
    expect(pauseDownloadMock).toHaveBeenCalledWith(content);
    expect(prismaMock.downloadTask.updateMany).toHaveBeenLastCalledWith({
      where: { id: "torrent", status: "RUNNING", aria2Gid: content, transferManifest: { equals: { metadataGid: meta } } },
      data: expect.objectContaining({ status: "PENDING", aria2Gid: content, transferManifest: { metadataGid: meta, pausedUntil: expect.any(Number) } }),
    });
  });

  it("preserves a legacy paused task's original deadline when refresh advances updatedAt", async () => {
    const updatedAt = new Date(Date.now() - 8 * 3600_000);
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "legacy", status: "PENDING", createdBy: "u_1", server: serverFixture(), targetPath: "/srv/cloud/downloads",
      aria2Gid: "gid", updatedAt, transferManifest: null,
    });
    tellStatusMock.mockResolvedValueOnce({ status: "active", completedLength: "1", totalLength: "5", downloadSpeed: "0" });
    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH", body: JSON.stringify({ taskId: "legacy", action: "refresh" }),
    }));
    expect(await response.json()).toMatchObject({ status: "PENDING" });
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ transferManifest: { pausedUntil: updatedAt.getTime() + 24 * 3600_000 } }),
    }));
  });

  it.each([true, false])("resumes a paused relay with a durable executor (live executor=%s)", async live => {
    const metadataGid = "1234567890abcdef";
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({ id: "paused", createdBy: "u_1", teamId: "team_1", server: serverFixture(),
      targetPath: "/srv/cloud/downloads", status: "PENDING", aria2Gid: "gid", transferManifest: { metadataGid, pausedUntil: Date.now() + 60_000 }, updatedAt: new Date() });
    prismaMock.job.findFirst.mockResolvedValueOnce(live ? { id: "live" } : null);
    enqueueDownloadExecutionJobMock.mockResolvedValueOnce({ id: "resume" } as never);
    const response = await PATCH(new Request("https://example.com/api/downloads", { method: "PATCH",
      body: JSON.stringify({ taskId: "paused", action: "resume" }) }));
    expect(response.ok).toBe(true);
    expect(enqueueDownloadExecutionJobMock).toHaveBeenCalledTimes(live ? 0 : 1);
    expect(prismaMock.job.findFirst.mock.lastCall?.[0].where.OR).toContainEqual({
      status: "PENDING", attempts: { lt: prismaMock.job.fields.maxAttempts },
    });
    if (!live) expect(enqueueDownloadExecutionJobMock).toHaveBeenCalledWith(expect.objectContaining({ taskId: "paused", mode: "aria2_relay" }), prismaMock);
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: "paused", status: "PENDING", aria2Gid: "gid" }),
      data: expect.objectContaining({ status: "RUNNING", transferManifest: { metadataGid, deadline: expect.any(Number) } }),
    });
  });

  it.each(["pause", "resume", "refresh"])("returns the winning cancellation after a concurrent %s RPC", async action => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({ id: "racing", createdBy: "u_1", server: serverFixture(),
      targetPath: "/srv/cloud/downloads", status: action === "resume" ? "PENDING" : "RUNNING", updatedAt: new Date(), aria2Gid: "gid", transferManifest: null });
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({ status: "CANCELLED", progress: null });
    if (action === "refresh") tellStatusMock.mockResolvedValueOnce({ status: "active", completedLength: "10", totalLength: "25", downloadSpeed: "0" });
    prismaMock.downloadTask.updateMany.mockResolvedValueOnce({ count: 0 });
    const response = await PATCH(new Request("https://example.com/api/downloads", { method: "PATCH", body: JSON.stringify({ taskId: "racing", action }) }));
    expect(response.status).toBe(action === "refresh" ? 200 : 409);
    expect(await response.json()).toMatchObject({ status: "CANCELLED" });
    expect(enqueueDownloadExecutionJobMock).not.toHaveBeenCalled();
  });

  it("does not mark an aria2 task resumed when the real resume operation fails", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_relay",
      createdBy: "u_1",
      server: serverFixture(),
      targetPath: "/srv/cloud/downloads/file.iso",
      status: "PENDING",
      aria2Gid: "gid_1",
      progress: "已暂停",
      updatedAt: new Date(),
    });
    unpauseDownloadMock.mockRejectedValueOnce(new Error("aria2 unavailable"));
    tellStatusMock.mockResolvedValueOnce({ status: "paused" });

    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ taskId: "task_relay", action: "resume" }),
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "恢复下载失败，远端任务状态未改变" });
    expect(unpauseDownloadMock).toHaveBeenCalledWith("gid_1");
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled();
  });

  it("does not mark a direct task cancelled when remote process termination fails", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_direct",
      createdBy: "u_1",
      targetPath: "/srv/cloud/downloads/file.iso",
      url: "https://example.com/file.iso",
      status: "RUNNING",
      pid: 12345,
      aria2Gid: null,
      relayMode: false,
      server: serverFixture(),
    });
    execRemoteCommandMock.mockReset();
    execRemoteCommandMock.mockRejectedValueOnce(new Error("ssh unavailable"));

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_direct", { method: "DELETE" }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "取消远程下载进程失败，任务状态未改变" });
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_direct" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
  });

  it("cancels an aria2 task before removing it and tolerates a failing removeDownload", async () => {
    // The CAS to CANCELLED runs first (A5-02): the relay worker polls aria2 every
    // 5 s and used to see "removed" before the row changed, fail the task and
    // notify, while this request answered 409.
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_relay",
      createdBy: "u_1",
      targetPath: "/srv/cloud/downloads/file.iso",
      url: "magnet:?xt=urn:btih:abcdef",
      status: "RUNNING",
      pid: null,
      aria2Gid: "gid_1",
      relayMode: true,
      server: serverFixture(),
    });
    prismaMock.downloadTask.updateManyAndReturn.mockResolvedValueOnce([{ aria2Gid: "gid_1", pid: null }]);
    removeDownloadMock.mockRejectedValueOnce(new Error("aria2 unavailable"));

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_relay", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(prismaMock.downloadTask.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_relay", transferManifest: { equals: expect.anything() }, status: { in: ["PENDING", "RUNNING"] } },
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
    expect(removeDownloadMock).toHaveBeenCalledWith("gid_1", true);
    expect(rmMock).toHaveBeenCalled();
  });

  it("purges terminal download task records without touching remote processes", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_done",
      createdBy: "u_1",
      targetPath: "/srv/cloud/downloads/file.iso",
      url: "https://example.com/file.iso",
      status: "COMPLETED",
      pid: 12345,
      aria2Gid: null,
      relayMode: false,
      server: serverFixture(),
    });
    prismaMock.downloadTask.deleteMany.mockResolvedValueOnce({ count: 1 });

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_done&purge=1", { method: "DELETE" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, purged: true });
    expect(prismaMock.downloadTask.deleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({ id: "task_done", status: "COMPLETED", OR: expect.any(Array) }) });
    expect(removeDownloadMock).not.toHaveBeenCalled();
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_done" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
  });

  it("rejects purging an active download task before cancellation", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_running",
      createdBy: "u_1",
      targetPath: "/srv/cloud/downloads/file.iso",
      url: "https://example.com/file.iso",
      status: "RUNNING",
      pid: 12345,
      aria2Gid: null,
      relayMode: false,
      server: serverFixture(),
    });

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_running&purge=1", { method: "DELETE" }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: "请先取消正在进行的任务，再删除记录" });
    expect(prismaMock.downloadTask.delete).not.toHaveBeenCalled();
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("refuses to cancel a task that already finished and keeps its result", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_done", createdBy: "u_1", targetPath: "/srv/cloud/downloads/file.iso",
      url: "https://example.com/file.iso", status: "COMPLETED", pid: 12345, aria2Gid: null,
      relayMode: false, server: serverFixture(),
    });

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_done", { method: "DELETE" }));

    expect(response.status).toBe(409);
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled();
  });

  it("treats a repeated cancel as done without stopping anything again", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_cancelled", createdBy: "u_1", targetPath: "/srv/cloud/downloads/file.iso",
      url: "magnet:?xt=urn:btih:abcdef", status: "CANCELLED", pid: null, aria2Gid: "gid_1",
      relayMode: true, server: serverFixture(),
    });

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_cancelled", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(removeDownloadMock).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a result that landed while the cancel was stopping the process", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_race", createdBy: "u_1", targetPath: "/srv/cloud/downloads/file.iso",
      url: "https://example.com/file.iso", status: "RUNNING", pid: 12345, aria2Gid: null,
      relayMode: false, server: serverFixture(),
    });
    execRemoteCommandMock.mockResolvedValueOnce({ stdout: "STOPPED\n", stderr: "", exitCode: 0 });
    prismaMock.downloadTask.updateMany.mockResolvedValueOnce({ count: 0 });

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_race", { method: "DELETE" }));

    expect(response.status).toBe(409);
    expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_race", status: { in: ["PENDING", "RUNNING"] } },
    }));
  });

  it("stops a running direct download on the server even when its pid was never stored", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_nopid", createdBy: "u_1", targetPath: "/srv/cloud/downloads",
      url: "https://example.com/file.iso", status: "RUNNING", pid: null, aria2Gid: null,
      relayMode: false, server: serverFixture(),
    });
    execRemoteCommandMock.mockReset();
    execRemoteCommandMock.mockResolvedValueOnce({ stdout: "STOPPED\n", stderr: "", exitCode: 0 });
    prismaMock.downloadTask.updateMany.mockResolvedValueOnce({ count: 1 });

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_nopid", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(execRemoteCommandMock).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.stringContaining("pkill -TERM -f"),
    }));
    expect(execRemoteCommandMock.mock.calls[0]![0].command).toContain("task_nopid");
    // A user cancel leaves the tombstone before it looks for processes.
    expect(execRemoteCommandMock.mock.calls[0]![0].command).toContain("/tmp/app-dl-task_nopid.cancel");
  });

  it("keeps cancellation pending without sending a probe to a rebound host", async () => {
    const server = { ...serverFixture(), hostKeySha256: "original-pin", managementMode: "DIRECT", operatingSystem: "LINUX" };
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_moved", createdBy: "u_1", targetPath: "/srv/cloud/downloads", url: "https://example.com/file.iso",
      status: "RUNNING", pid: 12345, aria2Gid: null, relayMode: false, directStorageNodeId: server.storageNode.id,
      transferManifest: { directEndpoint: directEndpointIdentity(server), phase: "dispatched", cleanupComplete: true },
      server: { ...server, host: "replacement.example", hostKeySha256: "new-pin" },
    });
    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_moved", { method: "DELETE" }));
    expect(response.status).toBe(409);
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled();
  });

  it("keeps a direct task RUNNING when the server cannot confirm the download stopped", async () => {
    // Other unconfirmed outputs (empty, NO_PGREP, null exit) are covered by
    // parseDirectDownloadStopResult in remote-stop.process.test.ts.
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_direct", createdBy: "u_1", targetPath: "/srv/cloud/downloads",
      url: "https://example.com/file.iso", status: "RUNNING", pid: 12345, aria2Gid: null,
      relayMode: false, server: serverFixture(),
    });
    execRemoteCommandMock.mockReset();
    execRemoteCommandMock.mockResolvedValueOnce({ stdout: "STILL_RUNNING\n", stderr: "", exitCode: 4 });

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_direct", { method: "DELETE" }));

    expect(response.status).toBe(502);
    expect(prismaMock.downloadTask.updateMany).not.toHaveBeenCalled();
  });

  it("cancels a task the worker claimed meanwhile as a running one (stops the remote process first)", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_claimed", createdBy: "u_1", targetPath: "/srv/cloud/downloads",
      url: "https://example.com/file.iso", status: "PENDING", pid: null, aria2Gid: null,
      relayMode: false, server: serverFixture(),
    });
    prismaMock.downloadTask.updateMany
      .mockResolvedValueOnce({ count: 0 }) // PENDING CAS lost: the worker claimed it
      .mockResolvedValueOnce({ count: 1 });
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({ status: "RUNNING" });
    execRemoteCommandMock.mockReset();
    execRemoteCommandMock.mockResolvedValueOnce({ stdout: "STOPPED\n", stderr: "", exitCode: 0 });

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_claimed", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(prismaMock.downloadTask.updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: "task_claimed", status: "PENDING" } });
    expect(execRemoteCommandMock).toHaveBeenCalledTimes(1);
    expect(execRemoteCommandMock.mock.invocationCallOrder[0]!).toBeLessThan(prismaMock.downloadTask.updateMany.mock.invocationCallOrder[1]!);
  });

  it("cleans the relay temp directory when cancelling a relay task even if pid is missing", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_relay",
      createdBy: "u_1",
      targetPath: "/srv/cloud/downloads/file.iso",
      url: "magnet:?xt=urn:btih:abcdef",
      status: "RUNNING",
      pid: null,
      aria2Gid: "gid_1",
      relayMode: true,
      server: serverFixture(),
    });

    prismaMock.downloadTask.updateManyAndReturn.mockResolvedValueOnce([{ aria2Gid: "gid_1", pid: null }]);
    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_relay", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(removeDownloadMock).toHaveBeenCalledWith("gid_1", true);
    expect(rmMock).toHaveBeenCalledWith(expect.stringContaining(relayTempDir("task_relay")), { recursive: true, force: true });
    expect(prismaMock.downloadTask.updateManyAndReturn).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_relay", transferManifest: { equals: expect.anything() }, status: { in: ["PENDING", "RUNNING"] } },
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
  });

  it("rolls back the transaction when enqueueDownloadExecutionJob rejects", async () => {
    prismaMock.downloadTask.create.mockResolvedValueOnce({ id: "task_dispatch_fail" });
    enqueueDownloadExecutionJobMock.mockRejectedValueOnce(
      new Error("jobs table unreachable"),
    );

    const response = await POST(request({
      url: "https://example.com/file.iso",
      serverId: "srv_1",
      targetPath: "downloads",
      fileName: "file.iso",
    }));

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload).toMatchObject({
      code: "DOWNLOAD_DISPATCH_FAILED",
      taskIds: [],
    });
    expect(payload.error).toMatch(/jobs table unreachable/);
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalled();
    expect(auditUserActionMock).toHaveBeenCalledWith("u_1", "download.dispatch_failed", expect.objectContaining({
      taskId: null,
      taskIds: [],
      errorMessage: "jobs table unreachable",
    }), undefined, "team_1");
  });

  it("fails only the enqueue-rejected batch task and keeps earlier enqueued tasks PENDING", async () => {
    prismaMock.downloadTask.create
      .mockResolvedValueOnce({ id: "task_batch_a" })
      .mockResolvedValueOnce({ id: "task_batch_b" })
      .mockResolvedValueOnce({ id: "task_batch_c" });
    enqueueDownloadExecutionJobMock
      .mockResolvedValueOnce({ id: "job-test-task_batch_a", type: "download.execute", status: "PENDING" })
      .mockRejectedValueOnce(new Error("jobs table blip"));

    const response = await POST(request({
      url: "https://example.com/one.iso",
      serverId: "srv_1",
      targetPath: "downloads",
      isBatch: true,
      batchUrls: [
        "https://example.com/one.iso",
        "https://example.com/two.iso",
        "https://example.com/three.iso",
      ],
    }));

    expect(response.status).toBe(500);
    const payload = await response.json();
    expect(payload.code).toBe("DOWNLOAD_DISPATCH_FAILED");
    expect(payload.taskIds).toEqual([]);
    expect(payload.succeededTaskIds).toEqual(["task_batch_a"]);
    expect(prismaMock.downloadTask.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalled();
    // We must NOT have created a third task row.
    expect(prismaMock.downloadTask.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/three.iso" }),
    );
  });

  it("keeps the happy path returning 200 success when every enqueue resolves", async () => {
    prismaMock.downloadTask.create.mockResolvedValueOnce({ id: "task_ok" });

    const response = await POST(request({
      url: "https://example.com/file.iso",
      serverId: "srv_1",
      targetPath: "downloads",
      fileName: "file.iso",
    }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      taskId: "task_ok",
      taskIds: ["task_ok"],
      count: 1,
    });
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) }),
    );
  });
});
