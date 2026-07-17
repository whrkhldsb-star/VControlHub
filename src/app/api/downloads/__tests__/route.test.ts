import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StorageAccessDecision } from "@/lib/storage/access-control";

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
  assertStorageAccessMock: vi.fn<() => Promise<StorageAccessDecision>>(() => Promise.resolve({ allowed: true })),
  prismaMock: {
    server: { findUnique: vi.fn() },
    downloadTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    fileEntry: {
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
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
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: assertStorageAccessMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logging", () => ({ logError: logErrorMock, createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: auditUserActionMock }));
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
  }: {
    mode: "aria2_relay" | "direct";
    taskId: string;
    userId?: string | null;
  }) => {
    const { executeAria2RelayDownload, executeDirectDownload } = await import(
      "@/lib/downloads/execution"
    );
    const { prisma } = await import("@/lib/db");
    const task = await prisma.downloadTask.findUnique({
      where: { id: taskId },
      include: { server: { include: { sshKey: true, storageNode: true } } },
    });
    // Build a DownloadServer shape that mirrors what the real worker (and
    // the old fire-and-forget route) would pass. The route-test mocks aria2
    // + ssh + fs at their module boundary, so the helper bodies run
    // happily and the existing `vi.waitFor(...)` assertions still see
    // the side effects.
    const serverForExec = task?.server
      ? {
          host: task.server.host,
          port: task.server.port,
          username: task.server.username,
          sshKeyId: task.server.sshKeyId,
          password: task.server.password,
          storageNode: task.server.storageNode
            ? { id: task.server.storageNode.id, basePath: task.server.storageNode.basePath }
            : null,
          sshKey: task.server.sshKey?.privateKey
            ? { privateKey: task.server.sshKey.privateKey }
            : null,
        }
      : {
          host: "203.0.113.10",
          port: 22,
          username: "root",
          sshKeyId: null,
          password: null,
          storageNode: { id: "store_1", basePath: "/srv/cloud" },
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

const session = { userId: "u_1", username: "alice", roles: ["admin"] as string[], currentTeamId: "team_1" as string | null, mustChangePassword: false };

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
    prismaMock.fileEntry.create.mockReset();
    prismaMock.fileEntry.update.mockReset();
    buildSshParamsFromServerMock.mockResolvedValue({ host: "203.0.113.10", port: 22, username: "root" });
    execRemoteCommandMock.mockResolvedValue({ stdout: "12345\n", stderr: "", exitCode: 0 });
    statMock.mockResolvedValue({ size: 1024 });
    // vi.clearAllMocks() also wipes the implementation we installed in the
    // vi.mock factory, so re-point the shared reference at the same body the
    // production module returns. New-A tests can still flip a single call
    // into a rejecting mode via enqueueDownloadExecutionJobMock.mockRejectedValueOnce().
    enqueueDownloadExecutionJobMock.mockReset();
    enqueueDownloadExecutionJobMock.mockImplementation(
      async ({ mode, taskId }: { mode: "aria2_relay" | "direct"; taskId: string; userId?: string | null }) => {
        const { executeAria2RelayDownload, executeDirectDownload } = await import(
          "@/lib/downloads/execution"
        );
        const { prisma } = await import("@/lib/db");
        const task = await prisma.downloadTask.findUnique({
          where: { id: taskId },
          include: { server: { include: { sshKey: true, storageNode: true } } },
        });
        const serverForExec = task?.server
          ? {
              host: task.server.host,
              port: task.server.port,
              username: task.server.username,
              sshKeyId: task.server.sshKeyId,
              password: task.server.password,
              storageNode: task.server.storageNode
                ? { id: task.server.storageNode.id, basePath: task.server.storageNode.basePath }
                : null,
              sshKey: task.server.sshKey?.privateKey
                ? { privateKey: task.server.sshKey.privateKey }
                : null,
            }
          : {
              host: "203.0.113.10",
              port: 22,
              username: "root",
              sshKeyId: null,
              password: null,
              storageNode: { id: "store_1", basePath: "/srv/cloud" },
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
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/filename|name|path/i) });
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
    await expect(response.json()).resolves.toMatchObject({ error: "Download URL DNS resolved to an intranet, loopback, or link-local address" });
    expect(lookupMock).toHaveBeenCalledWith("evil.example", { all: true, verbatim: true });
    expect(prismaMock.server.findUnique).not.toHaveBeenCalled();
    expect(assertStorageAccessMock).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.create).not.toHaveBeenCalled();
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("checks storage path grants before creating a download task", async () => {
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "没有该存储节点或路径的访问授权" });

    const response = await POST(request({
      url: "https://example.com/file.iso",
      serverId: "srv_1",
      targetPath: "private",
      fileName: "file.iso",
    }));

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ error: "没有该存储节点或路径的访问授权" });
    expect(assertStorageAccessMock).toHaveBeenCalledWith(expect.objectContaining({
      session,
      storageNodeId: "store_1",
      relativePath: "private",
      operation: "write",
    }));
    expect(prismaMock.downloadTask.create).not.toHaveBeenCalled();
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("indexes a started direct download as a pending storage file entry", async () => {
    prismaMock.downloadTask.create.mockResolvedValueOnce({ id: "task_direct" });
    // TR-001 (T12): the route now enqueues a durable `download.execute` job
    // and the test seam in this file looks the task row back up to dispatch
    // the real executeDirectDownload helper. Provide the row the seam needs
    // so fileName propagates into indexDownloadedFileEntry.
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
    // New-A (2026-06-15): the route now awaits enqueueDownloadExecutionJob
    // before returning 200. The mock seam still kicks off executeDirectDownload
    // in a microtask, so a single `vi.waitFor` needs a few event-loop ticks
    // to observe both the fileEntry.create (inside the microtask) and the
    // downstream downloadTask.update that executeDirectDownload issues right
    // after.
    await vi.waitFor(() => expect(prismaMock.fileEntry.create).toHaveBeenCalled());
    await vi.waitFor(() => expect(prismaMock.downloadTask.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_direct", status: "PENDING" },
      data: expect.objectContaining({ pid: 12345, status: "RUNNING", progress: "Downloading..." }),
    })));
    expect(prismaMock.fileEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        storageNodeId: "store_1",
        name: "app.iso",
        entryType: "FILE",
        relativePath: "downloads/app.iso",
        size: null,
      }),
    }));
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

  it("filters download list to owned tasks or readable storage targets", async () => {
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
    // Admin (team:manage) uses empty teamWhere — still filters by creator/storage ACL.
    expect(prismaMock.downloadTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {},
      orderBy: { createdAt: "desc" },
      take: 200,
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
    sessionHasPermissionMock.mockImplementation((_sess, permission) => permission !== "team:manage");
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([]);

    const response = await GET(new Request("https://example.com/api/downloads?serverId=srv_1&category=iso"));
    expect(response.status).toBe(200);
    expect(prismaMock.downloadTask.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        OR: [{ teamId: "team_1" }, { teamId: null }],
        serverId: "srv_1",
        category: "iso",
      },
      take: 200,
    }));
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

  it("returns 404 for cross-team task control (teamAccessFilter)", async () => {
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
        OR: [{ teamId: "team_1" }, { teamId: null }],
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

  it("reconciles terminal aria2 tasks from tellStatus", async () => {
    prismaMock.downloadTask.findMany.mockResolvedValueOnce([
      { id: "task_relay", createdBy: "u_1", targetPath: "/srv/cloud/downloads/file.iso", server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } }, status: "RUNNING", aria2Gid: "gid_1", pid: null, category: null, maxSpeedKb: null, totalBytes: null, completedBytes: null, downloadSpeed: null, fileSize: null, isBatch: false, batchUrls: null },
    ]);
    tellStatusMock.mockResolvedValueOnce({ gid: "gid_1", status: "complete", completedLength: "100", totalLength: "100", downloadSpeed: "0" });
    getGlobalStatMock.mockResolvedValueOnce({ downloadSpeed: "0" });

    const response = await GET(new Request("https://example.com/api/downloads"));

    expect(response.status).toBe(200);
    expect(ensureAria2DaemonMock).toHaveBeenCalledOnce();
    expect(tellStatusMock).toHaveBeenCalledWith("gid_1");
    expect(prismaMock.downloadTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_relay" },
      data: expect.objectContaining({ status: "COMPLETED", progress: "下载完成" }),
    }));
    expect(getGlobalStatMock).toHaveBeenCalledOnce();
  });

  it("refreshes a completed direct download from the remote process exit state", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_direct",
      createdBy: "u_1",
      url: "https://example.com/file.iso",
      status: "RUNNING",
      progress: "Downloading...",
      pid: 12345,
      aria2Gid: null,
      relayMode: false,
      targetPath: "/srv/cloud/downloads",
      fileName: "file.iso",
      server: serverFixture(),
    });
    execRemoteCommandMock.mockResolvedValueOnce({ stdout: "COMPLETED\n2048\n", stderr: "", exitCode: 0 });

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
    expect(prismaMock.downloadTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_direct" },
      data: expect.objectContaining({
        status: "COMPLETED",
        progress: "下载完成",
        fileSize: "2048",
        totalBytes: "2048",
        completedBytes: "2048",
      }),
    }));
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
      status: "COMPLETED",
      progress: "Completed · 4096 B",
      completedBytes: "4096",
      totalBytes: "4096",
      downloadSpeed: "0",
      downloadAccess: {
        mode: "direct-url",
        transport: "direct",
        href: "/api/storage/direct-access?nodeId=store_1&path=downloads%2Ffile.iso&download=1",
        fallbackHref: "/api/storage/sftp-download?nodeId=store_1&path=downloads%2Ffile.iso&download=1",
        label: "下载文件",
        statusLabel: "当前：直连",
      },
    });
    expect(prismaMock.downloadTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_relay" },
      data: expect.objectContaining({
        status: "COMPLETED",
        completedBytes: "4096",
        totalBytes: "4096",
        downloadSpeed: "0",
      }),
    }));
  });

  it("forbids cross-user task control when storage write access is absent", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_private",
      createdBy: "u_2",
      status: "RUNNING",
      aria2Gid: "gid_1",
      progress: "下载中",
      targetPath: "/srv/cloud/private/file.iso",
      server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "没有该存储节点或路径的访问授权" });

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
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: false, reason: "没有该存储节点或路径的访问授权" });

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

  it("does not mark an aria2 task paused when the real pause operation fails", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_relay",
      createdBy: "u_1",
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
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_relay" },
      data: expect.objectContaining({ status: "PENDING" }),
    }));
  });

  it("does not mark an aria2 task resumed when the real resume operation fails", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_relay",
      createdBy: "u_1",
      targetPath: "/srv/cloud/downloads/file.iso",
      status: "PENDING",
      aria2Gid: "gid_1",
      progress: "已暂停",
    });
    unpauseDownloadMock.mockRejectedValueOnce(new Error("aria2 unavailable"));

    const response = await PATCH(new Request("https://example.com/api/downloads", {
      method: "PATCH",
      body: JSON.stringify({ taskId: "task_relay", action: "resume" }),
    }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "恢复下载失败，远端任务状态未改变" });
    expect(unpauseDownloadMock).toHaveBeenCalledWith("gid_1");
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_relay" },
      data: expect.objectContaining({ status: "RUNNING" }),
    }));
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

  it("does not mark an aria2 task cancelled when removeDownload fails", async () => {
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
    removeDownloadMock.mockRejectedValueOnce(new Error("aria2 unavailable"));

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_relay", { method: "DELETE" }));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({ error: "取消 aria2 下载失败，任务状态未改变" });
    expect(rmMock).not.toHaveBeenCalled();
    expect(prismaMock.downloadTask.update).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_relay" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
  });

  it("purges terminal download task records without touching remote processes", async () => {
    prismaMock.downloadTask.findFirst.mockResolvedValueOnce({
      id: "task_done",
      createdBy: "u_1",
      targetPath: "/srv/cloud/downloads/file.iso",
      url: "https://example.com/file.iso",
      status: "COMPLETED",
      pid: 12345,
      aria2Gid: "gid_done",
      relayMode: false,
      server: serverFixture(),
    });
    prismaMock.downloadTask.delete.mockResolvedValueOnce({ id: "task_done" });

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_done&purge=1", { method: "DELETE" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, purged: true });
    expect(prismaMock.downloadTask.delete).toHaveBeenCalledWith({ where: { id: "task_done" } });
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

    const response = await DELETE(new Request("https://example.com/api/downloads?taskId=task_relay", { method: "DELETE" }));

    expect(response.status).toBe(200);
    expect(removeDownloadMock).toHaveBeenCalledWith("gid_1", true);
    expect(rmMock).toHaveBeenCalledWith(expect.stringContaining("/tmp/app-relay-task_relay"), { recursive: true, force: true });
    expect(prismaMock.downloadTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_relay" },
      data: expect.objectContaining({ status: "CANCELLED" }),
    }));
  });

  // New-A (2026-06-15): when the durable-job enqueue fails the route must
  // return 5xx and roll back the downloadTask row to FAILED, instead of
  // leaving it PENDING forever. The fire-and-forget path used to swallow
  // this exact error and reply success: true.
  it("rolls a single download task back to FAILED when enqueueDownloadExecutionJob rejects", async () => {
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
      taskIds: ["task_dispatch_fail"],
    });
    expect(payload.error).toMatch(/jobs table unreachable/);
    expect(prismaMock.downloadTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_dispatch_fail" },
      data: expect.objectContaining({
        status: "FAILED",
        progress: "任务派发失败",
        errorMessage: "jobs table unreachable",
      }),
    }));
    expect(auditUserActionMock).toHaveBeenCalledWith("u_1", "download.dispatch_failed", expect.objectContaining({
      taskId: "task_dispatch_fail",
      taskIds: ["task_dispatch_fail"],
      errorMessage: "jobs table unreachable",
    }));
  });

  it("rolls back every batch task to FAILED when one URL's enqueue rejects", async () => {
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
    // Route returns a deduped set of rolled-back ids; the order is
    // `failedTaskIds` ∪ `createdTaskIds` insertion order, so task_batch_b
    // (the rejected one) appears first, then task_batch_a (the previously
    // enqueued one). We assert membership + length because dedup of the
    // overlapping id (b) means a strict toEqual against [a, b, c] would
    // over-specify the contract.
    expect(payload.taskIds).toHaveLength(2);
    expect(new Set(payload.taskIds)).toEqual(new Set(["task_batch_a", "task_batch_b"]));
    // task_batch_a (succeeded enqueue) + task_batch_b (rejected) must both
    // be rolled back; task_batch_c was never created because the loop bailed
    // on the first rejection.
    expect(prismaMock.downloadTask.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.downloadTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_batch_a" },
      data: expect.objectContaining({ status: "FAILED", errorMessage: "jobs table blip" }),
    }));
    expect(prismaMock.downloadTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_batch_b" },
      data: expect.objectContaining({ status: "FAILED", errorMessage: "jobs table blip" }),
    }));
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
