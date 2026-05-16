import { describe, expect, it, vi } from "vitest";

const { requireSessionMock, sessionHasPermissionMock, prismaMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  prismaMock: {
    storageNode: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: requireSessionMock,
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

import { DELETE, POST } from "../route";

describe("/api/storage/direct-access", () => {
  it("returns 403 when the session lacks storage read permission", async () => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValueOnce({ userId: "u_1", username: "viewer" });
    sessionHasPermissionMock.mockReturnValueOnce(false);

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node_1", relativePath: "movies/demo.mp4" }),
      }),
    );

    expect(response.status).toBe(403);
    expect(prismaMock.storageNode.findUnique).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "无权限" });
  });

  it("returns 400 when required parameters are missing", async () => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValueOnce({ userId: "u_1", username: "admin" });
    sessionHasPermissionMock.mockReturnValueOnce(true);

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node_1" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(prismaMock.storageNode.findUnique).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "缺少 nodeId 或 relativePath" });
  });

  it("returns 404 when the storage node does not exist", async () => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValueOnce({ userId: "u_1", username: "admin" });
    sessionHasPermissionMock.mockReturnValueOnce(true);
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({ nodeId: "missing_node", relativePath: "movies/demo.mp4" }),
      }),
    );

    expect(response.status).toBe(404);
    expect(prismaMock.storageNode.findUnique).toHaveBeenCalledWith({
      where: { id: "missing_node" },
      select: { basePath: true },
    });
    await expect(response.json()).resolves.toMatchObject({ error: "存储节点不存在" });
  });

  it("returns 400 when the target path is the storage root", async () => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValueOnce({ userId: "u_1", username: "admin" });
    sessionHasPermissionMock.mockReturnValueOnce(true);
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({ basePath: "/data/file" });

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node_1", relativePath: "/" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: "请求路径超出存储节点根目录" });
  });

  it("disables direct public serving and returns a managed SFTP fallback", async () => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValueOnce({ userId: "u_1", username: "admin" });
    sessionHasPermissionMock.mockReturnValueOnce(true);
    prismaMock.storageNode.findUnique.mockResolvedValueOnce({ basePath: "/data/file" });

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node_1", relativePath: "movies/demo file.mp4" }),
      }),
    );

    expect(response.status).toBe(410);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: "VPS 直连播放已停用，请使用受控的 SFTP 中转预览/下载。",
      mode: "managed-download",
    });
    expect(payload.fallbackUrl).toBe(
      "/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo+file.mp4",
    );
  });

	it("keeps DELETE as an authenticated no-op for old clients", async () => {
		vi.clearAllMocks();
		requireSessionMock.mockResolvedValueOnce({ userId: "u_1", username: "admin" });
		sessionHasPermissionMock.mockReturnValueOnce(true);

		const response = await DELETE(new Request("http://local/api/storage/direct-access", { method: "DELETE" }));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ stopped: true, mode: "managed-download" });
	});
});
