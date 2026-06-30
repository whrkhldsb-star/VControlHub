import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  auditUserActionMock,
  execRemoteCommandMock,
  buildSshParamsFromServerMock,
  decryptServerPasswordMock,
  decryptSshPrivateKeyMock,
  serverFindUniqueMock,
} = vi.hoisted(() => ({
  auditUserActionMock: vi.fn(),
  execRemoteCommandMock: vi.fn(),
  buildSshParamsFromServerMock: vi.fn(),
  decryptServerPasswordMock: vi.fn((value: string) => `decrypted-password:${value}`),
  decryptSshPrivateKeyMock: vi.fn((value: string) => `decrypted-key:${value}`),
  serverFindUniqueMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: vi.fn(async () => ({ userId: "u1", username: "admin", roles: ["admin"] })),
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn(() => true),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: serverFindUniqueMock },
  },
}));

vi.mock("@/lib/ssh/client", () => ({
  execRemoteCommand: execRemoteCommandMock,
  buildSshParamsFromServer: buildSshParamsFromServerMock,
}));

vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: decryptServerPasswordMock,
  decryptSshPrivateKey: decryptSshPrivateKeyMock,
}));

vi.mock("@/lib/audit/service", () => ({
  auditUserAction: auditUserActionMock,
}));

import { POST } from "../route";

const session = { userId: "u1", username: "admin", roles: ["admin"] };
const params = { params: Promise.resolve({ id: "srv_1" }) };

function request(body: unknown) {
  return new Request("http://local/api/servers/srv_1/reload", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function mockServer(overrides: Partial<{
  id: string;
  host: string;
  port: number;
  username: string;
  password: string | null;
  sshKey: { privateKey: string } | null;
  osDialect: string | null;
}> = {}) {
  serverFindUniqueMock.mockResolvedValueOnce({
    id: "srv_1",
    host: "203.0.113.10",
    port: 22,
    username: "root",
    password: null,
    sshKey: { privateKey: "PRIVATE_KEY_BLOB" },
    osDialect: null, // TR-041: null = not detected, defaults to Debian/systemd
    ...overrides,
  });
  buildSshParamsFromServerMock.mockResolvedValueOnce({
    host: overrides.host ?? "203.0.113.10",
    port: overrides.port ?? 22,
    username: overrides.username ?? "root",
    privateKey: "decrypted-key:PRIVATE_KEY_BLOB",
    password: null,
  });
}

describe("POST /api/servers/[id]/reload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auditUserActionMock.mockReset();
    execRemoteCommandMock.mockReset();
    buildSshParamsFromServerMock.mockReset();
    decryptServerPasswordMock.mockClear();
    decryptSshPrivateKeyMock.mockClear();
    serverFindUniqueMock.mockReset();
  });

  it("runs systemctl reload <unit> over SSH and returns success", async () => {
    mockServer();
    execRemoteCommandMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });

    const response = await POST(request({ kind: "systemd", unit: "nginx" }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      exitCode: 0,
      // TR-041: dialect-aware command uses serviceCommand() — systemd reload with restart fallback
      command: expect.stringContaining("systemctl reload nginx"),
    });
    expect(execRemoteCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "203.0.113.10",
        port: 22,
        username: "root",
        command: expect.stringContaining("systemctl reload nginx"),
        timeout: 30_000,
      }),
    );
    expect(auditUserActionMock).toHaveBeenCalledWith(
      session.userId,
      "server.reload_ok",
      expect.objectContaining({ serverId: "srv_1", kind: "systemd", unit: "nginx" }),
      "INFO",
    );
  });

  it("returns success=false when remote exit code is non-zero without 5xx", async () => {
    mockServer();
    execRemoteCommandMock.mockResolvedValueOnce({
      stdout: "",
      stderr: "Job for nginx.service failed because the unit has a bad config",
      exitCode: 1,
    });

    const response = await POST(request({ kind: "systemd", unit: "nginx" }), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      exitCode: 1,
      stderr: expect.stringContaining("bad config"),
    });
    expect(auditUserActionMock).toHaveBeenCalledWith(
      session.userId,
      "server.reload_failed",
      expect.objectContaining({ serverId: "srv_1", kind: "systemd", unit: "nginx", exitCode: 1 }),
      "WARNING",
    );
  });

  it("rejects unit names with shell metacharacters via zod validation", async () => {
    const response = await POST(
      request({ kind: "systemd", unit: "nginx; rm -rf /" }),
      params,
    );

    expect(response.status).toBe(400);
    expect(serverFindUniqueMock).not.toHaveBeenCalled();
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
    expect(auditUserActionMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the server does not exist", async () => {
    serverFindUniqueMock.mockResolvedValueOnce(null);

    const response = await POST(request({ kind: "systemd", unit: "nginx" }), params);

    expect(response.status).toBe(404);
    expect(execRemoteCommandMock).not.toHaveBeenCalled();
  });

  it("returns 502 with audit error when the remote exec raises", async () => {
    mockServer();
    execRemoteCommandMock.mockRejectedValueOnce(new Error("connect ETIMEDOUT"));

    const response = await POST(request({ kind: "systemd", unit: "nginx" }), params);

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("ETIMEDOUT"),
    });
    expect(auditUserActionMock).toHaveBeenCalledWith(
      session.userId,
      "server.reload_error",
      expect.objectContaining({ serverId: "srv_1", kind: "systemd", unit: "nginx" }),
      "CRITICAL",
    );
  });

  it("builds docker compose command with projectDir and optional service for compose kind", async () => {
    mockServer();
    execRemoteCommandMock.mockResolvedValueOnce({
      stdout: "Container app-1  Started",
      stderr: "",
      exitCode: 0,
    });

    const response = await POST(
      request({
        kind: "compose",
        projectDir: "/opt/myapp",
        service: "web",
      }),
      params,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      exitCode: 0,
      command: expect.stringContaining("cd /opt/myapp && docker compose up -d web"),
    });
    expect(execRemoteCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({
        command: expect.stringContaining("cd /opt/myapp && docker compose up -d web"),
        timeout: 120_000,
      }),
    );
  });
});
