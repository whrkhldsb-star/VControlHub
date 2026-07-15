import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  serverFindUniqueMock,
  proxyFindUniqueMock,
  proxyUpdateMock,
  proxyUpsertMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  serverFindUniqueMock: vi.fn(),
  proxyFindUniqueMock: vi.fn(),
  proxyUpdateMock: vi.fn(),
  proxyUpsertMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: serverFindUniqueMock },
    serverFileProxy: {
      findUnique: proxyFindUniqueMock,
      update: proxyUpdateMock,
      upsert: proxyUpsertMock,
    },
  },
}));
vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: vi.fn((value: string) => value),
  decryptSshPrivateKey: vi.fn((value: string) => value),
}));

import { buildFileProxyScript } from "@/lib/server/file-proxy-script";
import { DELETE, GET, POST } from "../route";

const session = { userId: "u1", username: "admin", roles: ["admin"] };
const params = { params: Promise.resolve({ id: "srv_1" }) };

describe("/api/servers/[id]/file-proxy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValue(session);
    sessionHasPermissionMock.mockReturnValue(true);
    serverFindUniqueMock.mockResolvedValue({
      id: "srv_1",
      host: "127.0.0.1",
      port: 22,
      username: "root",
      password: null,
      sshKey: null,
      publicUrl: "https://node.example.com",
      fileProxyPort: 0,
      teamId: null,
      storageNode: { id: "node_1", basePath: "/srv/vcontrolhub/storage" },
    });
    proxyFindUniqueMock.mockResolvedValue(null);
    proxyUpdateMock.mockResolvedValue({});
  });

  it("uses shared auth guard and server:ssh permission for status", async () => {
    const response = await GET(
      new Request("http://local/api/servers/srv_1/file-proxy"),
      params,
    );

    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();
    expect(sessionHasPermissionMock).toHaveBeenCalledWith(
      session,
      "server:ssh",
    );
    await expect(response.json()).resolves.toMatchObject({
      status: "stopped",
      proxy: null,
    });
  });

  it("rejects callers without server ssh permission", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);

    const response = await GET(
      new Request("http://local/api/servers/srv_1/file-proxy"),
      params,
    );

    expect(response.status).toBe(403);
    expect(serverFindUniqueMock).not.toHaveBeenCalled();
  });

  it("keeps DELETE guard semantics and returns stopped when no proxy exists", async () => {
    const response = await DELETE(
      new Request("http://local/api/servers/srv_1/file-proxy", {
        method: "DELETE",
      }),
      params,
    );

    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();
    expect(sessionHasPermissionMock).toHaveBeenCalledWith(
      session,
      "server:ssh",
    );
    await expect(response.json()).resolves.toMatchObject({ status: "stopped" });
  });

  it("requires a bound storage node before starting a file proxy", async () => {
    serverFindUniqueMock.mockResolvedValueOnce({
      id: "srv_1",
      teamId: null,
    });
    serverFindUniqueMock.mockResolvedValueOnce({
      id: "srv_1",
      host: "127.0.0.1",
      port: 22,
      username: "root",
      password: null,
      sshKey: null,
      publicUrl: "https://node.example.com",
      fileProxyPort: 0,
      storageNode: null,
    });

    const response = await POST(
      new Request("http://local/api/servers/srv_1/file-proxy", {
        method: "POST",
      }),
      params,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("SFTP 存储节点"),
    });
    expect(proxyFindUniqueMock).not.toHaveBeenCalled();
    expect(proxyUpsertMock).not.toHaveBeenCalled();
  });

  it("generates a scoped proxy script with header tokens and restricted CORS", () => {
    const script = buildFileProxyScript({
      accessToken: "token-123",
      expiresAtMs: 1770000000000,
      serveDir: "/srv/vcontrolhub/storage",
      port: 31889,
      allowedOrigin: "https://hub.example.com",
    });

    expect(script).toContain('SERVE_DIR = "/srv/vcontrolhub/storage"');
    expect(script).toContain("X-VControlHub-Proxy-Token");
    expect(script).toContain("Authorization");
    expect(script).toContain('ALLOWED_ORIGIN = "https://hub.example.com"');
    expect(script).not.toContain('SERVE_DIR = "/"');
    expect(script).not.toContain('Access-Control-Allow-Origin", "*"');
  });
});
