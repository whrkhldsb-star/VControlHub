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

import { DELETE, GET } from "../route";

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
});
