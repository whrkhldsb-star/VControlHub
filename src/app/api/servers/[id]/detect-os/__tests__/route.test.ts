import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  auditUserActionMock,
  detectOsDialectMock,
  buildSshParamsFromServerMock,
  serverFindUniqueMock,
  serverUpdateMock,
  assertServerTeamAccessMock,
  sessionHasPermissionMock,
} = vi.hoisted(() => ({
  auditUserActionMock: vi.fn(),
  detectOsDialectMock: vi.fn(),
  buildSshParamsFromServerMock: vi.fn(),
  serverFindUniqueMock: vi.fn(),
  serverUpdateMock: vi.fn(),
  assertServerTeamAccessMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(() => true),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: vi.fn(async () => ({
    userId: "u1",
    username: "admin",
    roles: ["admin"],
    currentTeamId: "team_1",
  })),
  isSessionPayload: (value: unknown) =>
    Boolean(value && typeof value === "object" && value !== null && "userId" in value),
}));

vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: sessionHasPermissionMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    server: {
      findUnique: serverFindUniqueMock,
      update: serverUpdateMock,
    },
  },
}));

vi.mock("@/lib/ssh/client", () => ({
  buildSshParamsFromServer: buildSshParamsFromServerMock,
}));

vi.mock("@/lib/ssh/os-dialect", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ssh/os-dialect")>("@/lib/ssh/os-dialect");
  return {
    ...actual,
    detectOsDialect: detectOsDialectMock,
  };
});

vi.mock("@/lib/audit/service", () => ({
  auditUserAction: auditUserActionMock,
}));

vi.mock("@/lib/server/team-access", () => ({
  assertServerTeamAccess: assertServerTeamAccessMock,
}));

import { POST } from "../route";

const params = { params: Promise.resolve({ id: "srv_1" }) };

function request() {
  return new Request("http://local/api/servers/srv_1/detect-os", { method: "POST" });
}

describe("POST /api/servers/[id]/detect-os", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionHasPermissionMock.mockReturnValue(true);
    assertServerTeamAccessMock.mockResolvedValue({ ok: true });
    serverFindUniqueMock.mockResolvedValue({
      id: "srv_1",
      host: "203.0.113.10",
      port: 22,
      username: "root",
      sshKeyId: "key_1",
      password: null,
      hostKeySha256: "SHA256:abc",
      sshKey: { privateKey: "PRIVATE", passphrase: null },
    });
    buildSshParamsFromServerMock.mockResolvedValue({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE",
    });
    serverUpdateMock.mockResolvedValue({});
    auditUserActionMock.mockResolvedValue(undefined);
  });

  it("persists dialect + osInfo and returns a dialect summary with teamId audit", async () => {
    detectOsDialectMock.mockResolvedValueOnce({
      packageManager: "apt",
      serviceManager: "systemd",
      distroName: "Ubuntu 22.04 LTS",
      distroFamily: "debian",
      defaultShell: "/bin/bash",
      sudoPattern: "sudo -n",
      configPaths: {
        nginx: "/etc/nginx/nginx.conf",
        sshd: "/etc/ssh/sshd_config",
        fail2ban: "/etc/fail2ban/jail.local",
        docker: "/etc/docker/daemon.json",
      },
      detectedAt: "2026-07-19T00:00:00.000Z",
    });

    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      osInfo: "Ubuntu 22.04 LTS",
      fallback: false,
      dialect: {
        packageManager: "apt",
        serviceManager: "systemd",
        distroName: "Ubuntu 22.04 LTS",
        distroFamily: "debian",
      },
    });

    expect(detectOsDialectMock).toHaveBeenCalledTimes(1);
    expect(serverUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "srv_1" },
        data: expect.objectContaining({
          osInfo: "Ubuntu 22.04 LTS",
          osDialect: expect.stringContaining("\"packageManager\":\"apt\""),
        }),
      }),
    );
    expect(auditUserActionMock).toHaveBeenCalledWith(
      "u1",
      "server.detect_os",
      expect.objectContaining({
        serverId: "srv_1",
        distro: "Ubuntu 22.04 LTS",
        pm: "apt",
        sm: "systemd",
      }),
      "INFO",
      "team_1",
    );
  });

  it("still returns dialect on uname-style fallback instead of dialect:null", async () => {
    detectOsDialectMock.mockResolvedValueOnce({
      packageManager: "apk",
      serviceManager: "openrc",
      distroName: "Alpine (uname fallback)",
      distroFamily: "alpine",
      defaultShell: "/bin/ash",
      sudoPattern: "sudo -n",
      configPaths: {
        nginx: "/etc/nginx/nginx.conf",
        sshd: "/etc/ssh/sshd_config",
        fail2ban: "/etc/fail2ban/jail.local",
        docker: "/etc/docker/daemon.json",
      },
      detectedAt: "2026-07-19T00:00:00.000Z",
    });

    const response = await POST(request(), params);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      fallback: true,
      dialect: {
        packageManager: "apk",
        serviceManager: "openrc",
        distroName: "Alpine (uname fallback)",
      },
    });
  });

  it("returns 502 and audited error when SSH probe throws", async () => {
    detectOsDialectMock.mockRejectedValueOnce(new Error("All configured authentication methods failed"));

    const response = await POST(request(), params);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("All configured authentication methods failed"),
    });
    expect(auditUserActionMock).toHaveBeenCalledWith(
      "u1",
      "server.detect_os_error",
      expect.objectContaining({ serverId: "srv_1" }),
      "WARNING",
      "team_1",
    );
  });

  it("returns 403 when session lacks server:ssh", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);
    const response = await POST(request(), params);
    expect(response.status).toBe(403);
    expect(detectOsDialectMock).not.toHaveBeenCalled();
  });
});
