// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connection: undefined as unknown as (...args: unknown[]) => Promise<void>,
  options: {} as Record<string, unknown>,
  clients: new Set<{ bufferedAmount: number }>(),
  stream: undefined as unknown as EventEmitter & { write: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> },
  verify: vi.fn(), server: vi.fn(),
  handshakeUserId: "audit-user",
  audit: vi.fn(async () => undefined),
}));
vi.mock("http", async (original) => {
  const http = await original<typeof import("node:http")>();
  const { EventEmitter: Emitter } = await import("node:events");
  const createServer = () => new Emitter();
  return { ...http, createServer, default: { ...http, createServer } };
});
vi.mock("ws", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return { WebSocket: { OPEN: 1 }, WebSocketServer: class extends Emitter {
    clients = state.clients;
    constructor(options: Record<string, unknown>) { super(); state.options = options; }
    override on(event: string | symbol, listener: (...args: unknown[]) => void) {
      if (event === "connection") state.connection = listener as typeof state.connection;
      return super.on(event, listener);
    }
  } };
});
vi.mock("ssh2", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  return { Client: class extends Emitter {
    connect() { this.emit("ready"); }
    shell(_options: unknown, callback: (error: null, stream: unknown) => void) {
      state.stream = Object.assign(new Emitter(), { write: vi.fn(), close: vi.fn(), setWindow: vi.fn(), pause: vi.fn(), resume: vi.fn(), writableLength: 0, stderr: new Emitter() });
      callback(null, state.stream);
    }
    end() {}
  } };
});
vi.mock("@/lib/db", () => ({ prisma: { server: { findFirst: state.server, findUnique: async () => ({ teamId: "new-owner" }) }, $disconnect: vi.fn() } }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: state.audit }));
vi.mock("@/lib/auth/session", () => ({ getSessionCookieName: () => "audit_session", verifySessionToken: state.verify }));
vi.mock("@/lib/auth/ssh-ws-token", () => ({ verifySshWsHandshakeToken: () => ({ userId: state.handshakeUserId }) }));
vi.mock("@/lib/auth/team-scope", () => ({ serverTeamWhere: () => ({ teamId: "audit-team" }) }));
vi.mock("@/lib/ssh/ssh-key-crypto", async () => (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({ decryptServerPassword: (v: string) => v, decryptSshPrivateKey: (v: string) => v, decryptSshKeyPassphrase: (v: string) => v }));
vi.mock("@/lib/ssh/client", () => ({ createVerifiedSshConfig: (v: unknown) => v }));
vi.mock("@/lib/rdp/ws", () => ({ setupRdpWebSocket: () => () => undefined }));
vi.mock("@/lib/runtime-settings/service", () => ({ getSshTerminalRuntimeConfig: async () => ({ wsHeartbeatIntervalMs: 30_000, sshIdleTimeoutMs: 0 }) }));

const initialProcessListeners = new Map<string, ReturnType<typeof process.listeners>>();
beforeEach(() => {
  for (const event of ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"]) initialProcessListeners.set(event, process.listeners(event));
  vi.resetModules(); vi.useFakeTimers(); state.clients.clear(); state.verify.mockReset(); state.server.mockReset(); state.audit.mockClear();
  state.handshakeUserId = "audit-user";
  vi.stubEnv("SSH_WS_SECRET", "fixture-only"); vi.stubEnv("SSH_WS_ALLOWED_ORIGINS", "http://127.0.0.1:15430");
  state.verify.mockResolvedValue({ userId: "audit-user", username: "audit", roles: ["operator"], permissions: ["server:ssh"], currentTeamId: "audit-team", mustChangePassword: false });
  state.server.mockResolvedValue({ id: "audit-server", enabled: true, operatingSystem: "LINUX", host: "192.0.2.2", port: 22, username: "audit", connectionType: "PASSWORD", password: "fixture-only", sshKey: null, hostKeySha256: "fixture-pin", teamId: "audit-team" });
});
afterEach(() => {
  vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs();
  for (const [event, listeners] of initialProcessListeners) {
    for (const listener of process.listeners(event)) if (!listeners.includes(listener)) process.removeListener(event, listener);
  }
});

async function connect(expectConnected = true, query = "", cookies = "") {
  await import("@/ssh-ws-proxy");
  const socket = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(), ping: vi.fn(), terminate: vi.fn() });
  socket.close.mockImplementation(() => { socket.readyState = 3; state.clients.delete(socket); socket.emit("close"); });
  socket.ping.mockImplementation(() => socket.emit("pong"));
  state.clients.add(socket);
  await state.connection(socket, { url: `/ssh?serverId=audit-server&handshake=fixture${query}`, headers: { origin: "http://127.0.0.1:15430", cookie: `audit_session=fixture-cookie${cookies}` } });
  if (expectConnected) expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "connected", inputAck: true, heartbeat: true }));
  return socket;
}

/** The `session` message the proxy sends right after `connected`. */
function sessionMessage(socket: { send: ReturnType<typeof vi.fn> }) {
  const raw = socket.send.mock.calls.map((call) => String(call[0])).find((text) => text.includes('"type":"session"'));
  return raw ? JSON.parse(raw) as { type: "session"; resumeId: string | null; resumed: boolean; keepAliveMs: number; offset: number; replayTruncated: boolean } : null;
}

it("rechecks a detached shell and attributes its close to the team that opened it", async () => {
  const socket = await connect(true, "&keepAlive=1");
  socket.close();
  expect(state.stream.close).not.toHaveBeenCalled();
  state.server.mockResolvedValue(null);
  await vi.advanceTimersByTimeAsync(30_001);
  expect(state.stream.close).toHaveBeenCalledTimes(1);
  expect(state.audit).toHaveBeenCalledWith("audit-user", "server.ssh.closed", { serverId: "audit-server" }, undefined, "audit-team");
});

it("allows a single outstanding resume and ignores input and closes from former attachments", async () => {
  const original = await connect(true, "&keepAlive=1");
  const query = "&keepAlive=1&resume=" + sessionMessage(original)!.resumeId;
  const verified = await state.verify();
  const gate = Promise.withResolvers<typeof verified>();
  const claimed = Promise.withResolvers<void>();
  state.verify.mockResolvedValueOnce(verified).mockImplementationOnce(() => {
    claimed.resolve();
    return gate.promise;
  });
  const first = connect(true, query);
  await claimed.promise;
  const second = await connect(false, query);
  expect(second.close).toHaveBeenCalledWith(1013, expect.anything());
  gate.resolve(verified);
  const attached = await first;
  const input = Buffer.from(JSON.stringify({ type: "input", data: "YQ==" }));
  original.emit("message", input, false);
  original.emit("close");
  second.emit("message", input, false);
  attached.emit("message", input, false);
  await vi.advanceTimersByTimeAsync(0);
  expect(state.stream.write).toHaveBeenCalledTimes(1);
  expect(state.stream.close).not.toHaveBeenCalled();
  expect(sessionMessage(attached)?.resumed).toBe(true);
});

it("closes the claimant when the remote shell exits during reauthorization", async () => {
  const original = await connect(true, "&keepAlive=1");
  const identity = await state.verify();
  const check = Promise.withResolvers<typeof identity>();
  const claimed = Promise.withResolvers<void>();
  state.verify.mockResolvedValueOnce(identity).mockImplementationOnce(() => {
    claimed.resolve();
    return check.promise;
  });
  const reconnect = connect(false, "&keepAlive=1&resume=" + sessionMessage(original)!.resumeId);
  await claimed.promise;
  state.stream.emit("close");
  check.resolve(identity);
  const socket = await reconnect;
  expect(socket.close).toHaveBeenCalledTimes(1);
  expect(socket.send).toHaveBeenCalledWith(expect.stringContaining('"reason":"lost"'));
});
