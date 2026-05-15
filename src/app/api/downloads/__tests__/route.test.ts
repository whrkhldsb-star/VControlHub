import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireSessionMock,
  sessionHasPermissionMock,
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
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(() => true),
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

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
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

import { DELETE, POST } from "../route";

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
      data: expect.objectContaining({ pid: 12345, progress: "下载中..." }),
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

  it("cleans the relay temp directory when cancelling a relay task even if pid is missing", async () => {
    prismaMock.downloadTask.findUnique.mockResolvedValueOnce({
      id: "task_relay",
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
