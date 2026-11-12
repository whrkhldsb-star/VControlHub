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
  sshReplies: [] as Array<[string, string]>,
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
        const scripted = sshReplies.find(([key]) => command.includes(key))?.[1];
        const stdout = scripted !== undefined
          ? scripted
          : command.includes("nohup python3")
          ? "4242\n"
          : command.includes("tail -n 20")
            ? "bind failed\n__PROXY_EXITED__\n"
            : "";
        if (stdout) handlers.data?.(Buffer.from(stdout));
        handlers.close?.(0);
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
    releaseLockMock.mockResolvedValue(undefined);
    acquireLockMock.mockResolvedValue(releaseLockMock);
    sshCommands.length = 0;
    sshReplies.length = 0;
  });

  describe("a pid stored when the proxy started", () => {
    // The number names the proxy only while the proxy lives. After a reboot or
    // a kill by hand it is free for any other process, and the row keeps it:
    // an expired entry sent SIGTERM to that number on every status call, and
    // "ps -p" reported whatever process had it as the running proxy.
    const IDENTITY = "tr '\\0' ' ' < /proc/4242/cmdline 2>/dev/null | grep -q '.vps_file_proxy_'";
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
    const signals = () => sshCommands.filter((command) => /\bkill\b/.test(command));

    it("reports the proxy running only when that process is the proxy", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow());

      sshReplies.push(["/proc/4242/cmdline", "proxy_running\n"]);
      await expect((await status()).json()).resolves.toMatchObject({ status: "running", proxy: { port: 8765, accessToken: "token-123" } });
      expect(sshCommands[0]).toContain(IDENTITY);

      // Another process has the number now.
      sshReplies.length = 0;
      sshReplies.push(["/proc/4242/cmdline", "not_running\n"]);
      await expect((await status()).json()).resolves.toEqual({ status: "stopped", proxy: null });
      expect(proxyUpdateMock).toHaveBeenCalledWith({ where: { id: "proxy_1" }, data: { status: "stopped" } });
      expect(signals()).toEqual([]);
    });

    it("signals it at expiry only after checking that it is the proxy", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow({ expiresAt: new Date(Date.now() - 1000) }));

      await expect((await status()).json()).resolves.toEqual({ status: "stopped", proxy: null });

      expect(signals()).toHaveLength(1);
      expect(signals()[0]).toContain(`if ${IDENTITY}; then kill 4242 2>/dev/null; fi`);
    });

    it("sends nothing for an expired entry that was already stopped", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow({ status: "stopped", expiresAt: new Date(Date.now() - 86_400_000) }));

      await status();
      await status();

      expect(signals()).toEqual([]);
    });

    it("stops a proxy on request behind the same check", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow());

      const response = await DELETE(new Request("http://local/api/servers/srv_1/file-proxy", { method: "DELETE" }), params);

      await expect(response.json()).resolves.toEqual({ status: "stopped" });
      expect(signals()).toHaveLength(1);
      expect(signals()[0]).toContain(`if ${IDENTITY}; then kill 4242 2>/dev/null; fi`);
    });

    it("recognises a live proxy before starting another", async () => {
      proxyFindUniqueMock.mockResolvedValue(proxyRow());
      sshReplies.push(["/proc/4242/cmdline", "proxy_running\n"]);

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
    expect(proxyFindUniqueMock).not.toHaveBeenCalled();
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
      storageNode: { id: "node_1", basePath: "/srv/vcontrolhub/storage" },
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
        expect.stringContaining("kill 4242"),
      ]),
    );
    expect(sshCommands.some((command) => command.includes(".out"))).toBe(true);
    expect(proxyUpsertMock).not.toHaveBeenCalled();
    expect(releaseLockMock).toHaveBeenCalledTimes(1);
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
