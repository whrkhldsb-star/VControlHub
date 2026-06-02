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
  sessionHasPermissionMock: vi.fn(() => true),
  assertStorageAccessMock: vi.fn<() => Promise<StorageAccessDecision>>(() => Promise.resolve({ allowed: true })),
  prismaMock: {
    server: { findUnique: vi.fn() },
    downloadTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
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

import { DELETE, GET, PATCH, POST } from "../route";

const session = { userId: "u_1", username: "alice", roles: ["admin"] };

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
    storageNode: { id: "store_1", basePath: "/srv/cloud", driver: "SFTP" },
  };
}

describe("/api/downloads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    requireSessionMock.mockResolvedValue(session);
    sessionHasPermissionMock.mockReturnValue(true);
    prismaMock.server.findUnique.mockResolvedValue(serverFixture());
    prismaMock.downloadTask.create.mockResolvedValue({ id: "task_1" });
    buildSshParamsFromServerMock.mockResolvedValue({ host: "203.0.113.10", port: 22, username: "root" });
    execRemoteCommandMock.mockResolvedValue({ stdout: "12345\n", stderr: "", exitCode: 0 });
    statMock.mockResolvedValue({ size: 1024 });
  });

  it("rejects unsafe custom file names before creating a task", async () => {
    const response = await POST(request({
      url: "https://example.com/file.iso",
      serverId: "srv_1",
      targetPath: "/srv/cloud/downloads",
      fileName: "../evil.iso",
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringMatching(/文件名|名称|路径/) });
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
    await expect(response.json()).resolves.toMatchObject({ error: "下载链接 DNS 解析到内网、回环或链路本地地址" });
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
    prismaMock.fileEntry.findFirst.mockResolvedValueOnce(null);

    const response = await POST(request({
      url: "https://example.com/releases/app.iso",
      serverId: "srv_1",
      targetPath: "downloads",
      fileName: "app.iso",
    }));

    expect(response.status).toBe(200);
    await vi.waitFor(() => expect(prismaMock.fileEntry.create).toHaveBeenCalled());
    expect(prismaMock.downloadTask.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "task_direct" },
      data: expect.objectContaining({ pid: 12345, status: "RUNNING", progress: "下载中..." }),
    }));
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

  it("rejects batch downloads instead of silently dropping URLs", async () => {
    const response = await POST(request({
      url: "https://example.com/one.iso",
      serverId: "srv_1",
      targetPath: "downloads",
      isBatch: true,
      batchUrls: ["https://example.com/one.iso", "https://example.com/two.iso"],
    }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("批量下载暂不支持") });
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
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
      id: "task_direct",
      createdBy: "u_1",
      url: "https://example.com/file.iso",
      status: "RUNNING",
      progress: "下载中...",
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
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
      id: "task_relay",
      createdBy: "u_1",
      status: "RUNNING",
      progress: "下载中",
      aria2Gid: "gid_1",
      targetPath: "/srv/cloud/downloads/file.iso",
      server: { ...serverFixture(), storageNode: { id: "store_1", basePath: "/srv/cloud" } },
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
      progress: "完成 · 4096 B",
      completedBytes: "4096",
      totalBytes: "4096",
      downloadSpeed: "0",
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
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
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
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
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
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
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
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
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
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
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
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
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

  it("cleans the relay temp directory when cancelling a relay task even if pid is missing", async () => {
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
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
});
