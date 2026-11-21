import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  sessionHasPermissionMock,
  serverFindUniqueMock,
  proxyFindUniqueMock,
  proxyUpdateMock,
  proxyUpsertMock,
  acquireLockMock,
  releaseLockMock,
  sshCommands,
  sshReplies,
  sshStdin,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  serverFindUniqueMock: vi.fn(),
  proxyFindUniqueMock: vi.fn(),
  proxyUpdateMock: vi.fn(),
  proxyUpsertMock: vi.fn(),
  acquireLockMock: vi.fn(),
  releaseLockMock: vi.fn(),
  sshCommands: [] as string[],
  /** What the remote shell prints for a command containing the key. */
  sshReplies: [] as Array<[string, string, number?]>,
  sshStdin: [] as string[],
}));

vi.mock("ssh2", () => ({
  Client: class {
    private handlers: Record<string, (...args: unknown[]) => void> = {};

    on(event: string, handler: (...args: unknown[]) => void) {
      this.handlers[event] = handler;
      return this;
    }

    connect() {
      this.handlers.ready?.();
    }

    exec(
      command: string,
      _options: unknown,
      callback: (error: Error | null, stream: unknown) => void,
    ) {
      sshCommands.push(command);
      const handlers: Record<string, (...args: unknown[]) => void> = {};
      const stderrHandlers: Record<string, (...args: unknown[]) => void> = {};
      const stream = {
        end(data?: string) { if (data) sshStdin.push(data); },
        on(event: string, handler: (...args: unknown[]) => void) {
          handlers[event] = handler;
          return stream;
        },
        stderr: {
          on(event: string, handler: (...args: unknown[]) => void) {
            stderrHandlers[event] = handler;
            return stream.stderr;
          },
        },
      };
      callback(null, stream);
      queueMicrotask(() => {
        const reply = sshReplies.find(([key]) => command.includes(key));
        const scripted = reply?.[1];
        const stdout = scripted !== undefined
          ? scripted
          : command.includes("nohup python3")
          ? "4242 /tmp/.vps_file_proxy_aB12345678\n"
          : command.includes("signal.SIGTERM")
            ? "not_running\n"
            : "";
        if (stdout) handlers.data?.(Buffer.from(stdout));
        handlers.close?.(reply?.[2] ?? 0);
      });
    }

    end() {}
  },
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,
  isSessionPayload: (value: unknown) =>
    Boolean(value && typeof value === "object" && value !== null && "userId" in value),
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
vi.mock("@/lib/ssh/ssh-key-crypto", async () => (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({
  decryptServerPassword: vi.fn((value: string) => value),
  decryptSshPrivateKey: vi.fn((value: string) => value),
}));
vi.mock("@/lib/ssh/client", () => ({
  createVerifiedSshConfig: vi.fn(() => ({})),
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  acquireAdvisoryLock: acquireLockMock,
}));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: vi.fn(),
}));

import { auditUserAction } from "@/lib/audit/service";
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
      storageNode: { id: "node_1", driver: "SFTP", teamId: null, basePath: "/srv/vcontrolhub/storage" },
    });
    proxyFindUniqueMock.mockResolvedValue(null);
    proxyUpdateMock.mockResolvedValue({});
    proxyUpsertMock.mockResolvedValue({ id: "proxy_1" });
    releaseLockMock.mockResolvedValue(undefined);
    acquireLockMock.mockResolvedValue(releaseLockMock);
    sshCommands.length = 0;
    sshStdin.length = 0;
    sshReplies.length = 0;
  });

  describe("a pid stored when the proxy started", () => {
    // The number names the proxy only while the proxy lives. After a reboot or
    // a kill by hand it is free for any other process, and the row keeps it:
    // an expired entry sent SIGTERM to that number on every status call, and
    // "ps -p" reported whatever process had it as the running proxy.
    const IDENTITY = 'open(f"/proc/{pid}/cmdline"';
    const proxyRow = (overrides: Record<string, unknown> = {}) => ({
      id: "proxy_1",
      serverId: "srv_1",
      proxyType: "python_http",
      port: 8765,
      status: "running",
      pid: 4242,
      accessToken: "token-123",
      expiresAt: new Date(Date.now() + 3_600_000),
      ...overrides,
    });
    const status = () => GET(new Request("http://local/api/servers/srv_1/file-proxy"), params);
    const signals = () => sshCommands.filter((command) => command.includes("signal.SIGTERM"));

    it("reports the proxy running only when that process is the proxy", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow());

      sshReplies.push(["pid = 4242", "proxy_running\n"]);
      await expect((await status()).json()).resolves.toMatchObject({ status: "running", proxy: { port: 8765, accessToken: "token-123" } });
      expect(sshCommands[0]).toContain(IDENTITY);

      // Another process has the number now.
      sshReplies.length = 0;
      sshReplies.push(["pid = 4242", "not_running\n"]);
      await expect((await status()).json()).resolves.toEqual({ status: "stopped", proxy: null });
      expect(proxyUpdateMock).toHaveBeenCalledWith({ where: { id: "proxy_1" }, data: { status: "stopped", accessToken: null, pid: null, expiresAt: null } });
      expect(signals()).toEqual([]);
    });

    it("signals it at expiry only after checking that it is the proxy", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow({ expiresAt: new Date(Date.now() - 1000) }));

      await expect((await status()).json()).resolves.toEqual({ status: "stopped", proxy: null });

      expect(signals()).toHaveLength(1);
      expect(signals()[0]).toContain(IDENTITY);
      expect(signals()[0]).toContain('if result == "proxy_running"');
    });

    it("sends nothing for an expired entry that was already stopped", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow({ status: "stopped", pid: null, accessToken: null, expiresAt: null }));

      await status();
      await status();

      expect(signals()).toEqual([]);
    });

    it("stops a proxy on request behind the same check", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow());

      const response = await DELETE(new Request("http://local/api/servers/srv_1/file-proxy", { method: "DELETE" }), params);

      await expect(response.json()).resolves.toEqual({ status: "stopped" });
      expect(signals()).toHaveLength(1);
      expect(signals()[0]).toContain(IDENTITY);
      expect(signals()[0]).toContain('if result == "proxy_running"');
    });

    it.each([
      ["proxy_running", 0, 409],
      ["unknown", 0, 502],
      ["not_running", 255, 502],
    ] as const)("retains retryable remote state on %s with exit %s", async (out, exit, statusCode) => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow());
      sshReplies.push(["pid = 4242", out, exit]);
      const response = await DELETE(new Request("http://local", { method: "DELETE" }), params);
      expect(response.status).toBe(statusCode);
      expect(proxyUpdateMock).not.toHaveBeenCalled();
      expect(auditUserAction).not.toHaveBeenCalled();
    });

    it("keeps a proxy active when a status probe cannot confirm liveness", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow());
      sshReplies.push(["pid = 4242", "", 255]);
      expect((await status()).status).toBe(502);
      expect(proxyUpdateMock).not.toHaveBeenCalled();
      expect((await POST(new Request("http://local", { method: "POST" }), params)).status).toBe(502);
      expect(proxyUpsertMock).not.toHaveBeenCalled();
    });

    it.each([60_000, -60_000])("verifies the PID of legacy stopped records even across expiry (%s)", async (offset) => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow({ status: "stopped", expiresAt: new Date(Date.now() + offset) }));
      sshReplies.push(["pid = 4242", "proxy_running"]);
      expect((await status()).status).toBe(409);
      expect(proxyUpdateMock).not.toHaveBeenCalled();
    });

    it("recognises a live proxy before starting another", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow());
      sshReplies.push(["pid = 4242", "proxy_running\n"]);

      const response = await POST(new Request("http://local/api/servers/srv_1/file-proxy", { method: "POST" }), params);

      await expect(response.json()).resolves.toMatchObject({ status: "running", proxy: { accessToken: "token-123" } });
      expect(sshCommands.some((command) => command.includes("nohup python3"))).toBe(false);
    });
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

  it("does not expose a whole-node proxy token without node management permission", async () => {
    sessionHasPermissionMock.mockImplementation((_session, permission) => permission !== "storage:manage-node");

    const response = await GET(new Request("http://local/api/servers/srv_1/file-proxy"), params);

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
    for (let index = 0; index < 3; index += 1) {
      serverFindUniqueMock.mockResolvedValueOnce({ id: "srv_1", teamId: null });
    }
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
    expect(sshCommands).toEqual([]);
    expect(proxyUpsertMock).not.toHaveBeenCalled();
  });

  it("kills and cleans up a remote proxy that exits before becoming ready", async () => {
    serverFindUniqueMock.mockResolvedValue({
      id: "srv_1",
      host: "127.0.0.1",
      port: 48163,
      username: "root",
      password: "encrypted-password",
      sshKey: null,
      hostKeySha256: null,
      publicUrl: "https://node.example.com",
      fileProxyPort: 0,
      teamId: null,
      storageNode: { id: "node_1", driver: "SFTP", teamId: null, basePath: "/srv/vcontrolhub/storage" },
    });

    const response = await POST(
      new Request("http://local/api/servers/srv_1/file-proxy", {
        method: "POST",
      }),
      params,
    );

    expect(response.status).toBe(502);
    expect(sshCommands).toEqual(
      expect.arrayContaining([
        expect.stringContaining("nohup python3"),
        expect.stringContaining("kill -0 4242"),
        expect.stringContaining("signal.SIGTERM"),
      ]),
    );
    expect(sshCommands.some((command) => command.includes(".out"))).toBe(true);
    expect(proxyUpsertMock).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ pid: 4242, status: "starting" }) }));
    expect(proxyUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "stopped", accessToken: null }) }));
    expect(sshStdin[0]).toContain("TOKEN = ");
    expect(sshCommands.every(command => !command.includes("TOKEN = "))).toBe(true);
    expect(releaseLockMock).toHaveBeenCalledTimes(1);
  });

  it.each([{ host: "other" }, { port: 2222 }, { teamId: "former-owner" }])("rejects a storage node on a different endpoint %o before SSH", async (override) => {
    serverFindUniqueMock.mockResolvedValue({
      id: "srv_1", teamId: null, host: "server", port: 22, publicUrl: "https://node.example.com",
      storageNode: { teamId: null, driver: "SFTP", basePath: "/data", ...override },
    });
    const response = await POST(new Request("http://local", { method: "POST" }), params);
    expect(response.status).toBe(400);
    expect(sshCommands).toEqual([]);
    expect(proxyUpsertMock).not.toHaveBeenCalled();
  });

  it("rechecks the authorized team under the transfer lock before accessing a token", async () => {
    serverFindUniqueMock.mockImplementation(async ({ where }) => "teamId" in where ? null : { id: "srv_1", teamId: "old" });
    const response = await GET(new Request("http://local"), params);
    expect(response.status).toBe(404);
    expect(acquireLockMock).toHaveBeenCalledWith("server-delete", "srv_1");
    expect(serverFindUniqueMock).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "srv_1", teamId: "old", enabled: true } }));
    expect(proxyFindUniqueMock).not.toHaveBeenCalled();
    expect(sshCommands).toEqual([]);
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
    expect(script).toContain("hmac.compare_digest");
    expect(script).toContain("_token_matches");
    expect(script).not.toContain("self._request_token() != TOKEN");
    expect(script).toContain('ALLOWED_ORIGIN = "https://hub.example.com"');
    expect(script).not.toContain('SERVE_DIR = "/"');
    expect(script).not.toContain('Access-Control-Allow-Origin", "*"');
  });
});
