// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connection: undefined as unknown as (...args: unknown[]) => Promise<void>,
  options: {} as Record<string, unknown>,
  clients: new Set<{ bufferedAmount: number }>(),
  stream: undefined as unknown as EventEmitter & { write: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn>; resume: ReturnType<typeof vi.fn> },
  verify: vi.fn(), server: vi.fn(),
  handshakeUserId: "audit-user",
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
vi.mock("@/lib/db", () => ({ prisma: { server: { findFirst: state.server }, $disconnect: vi.fn() } }));
vi.mock("@/lib/auth/session", () => ({ getSessionCookieName: () => "audit_session", verifySessionToken: state.verify }));
vi.mock("@/lib/auth/ssh-ws-token", () => ({ verifySshWsHandshakeToken: () => ({ userId: state.handshakeUserId }) }));
vi.mock("@/lib/auth/team-scope", () => ({ serverTeamWhere: () => ({ teamId: "audit-team" }) }));
vi.mock("@/lib/ssh/ssh-key-crypto", () => ({ decryptServerPassword: (v: string) => v, decryptSshPrivateKey: (v: string) => v, decryptSshKeyPassphrase: (v: string) => v }));
vi.mock("@/lib/ssh/client", () => ({ createVerifiedSshConfig: (v: unknown) => v }));
vi.mock("@/lib/rdp/ws", () => ({ setupRdpWebSocket: () => () => undefined }));
vi.mock("@/lib/runtime-settings/service", () => ({ getSshTerminalRuntimeConfig: async () => ({ wsHeartbeatIntervalMs: 30_000, sshIdleTimeoutMs: 0 }) }));

const initialProcessListeners = new Map<string, ReturnType<typeof process.listeners>>();
beforeEach(() => {
  for (const event of ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"]) initialProcessListeners.set(event, process.listeners(event));
  vi.resetModules(); vi.useFakeTimers(); state.clients.clear(); state.verify.mockReset(); state.server.mockReset();
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

async function connect(expectConnected = true) {
  await import("../ssh-ws-proxy");
  const socket = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(), ping: vi.fn(), terminate: vi.fn() });
  socket.close.mockImplementation(() => { socket.readyState = 3; state.clients.delete(socket); socket.emit("close"); });
  socket.ping.mockImplementation(() => socket.emit("pong"));
  state.clients.add(socket);
  await state.connection(socket, { url: "/ssh?serverId=audit-server&handshake=fixture", headers: { origin: "http://127.0.0.1:15430", cookie: "audit_session=fixture-cookie" } });
  if (expectConnected) expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "connected" }));
  return socket;
}

it("stops an already connected shell after account/session revocation", async () => {
  const socket = await connect();
  state.verify.mockRejectedValue(new Error("Revoked"));
  await vi.advanceTimersByTimeAsync(30_000);
  socket.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "YXVkaXQ=" })), false);
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.close).toHaveBeenCalled(); expect(state.stream.write).not.toHaveBeenCalled();
});

it("stops on revoked node access", async () => {
  const socket = await connect(); state.server.mockResolvedValue(null);
  await vi.advanceTimersByTimeAsync(30_000); expect(socket.close).toHaveBeenCalled();
});

it("fails closed when authorization cannot be refreshed within its deadline", async () => {
  const socket = await connect(); state.verify.mockImplementation(() => new Promise(() => undefined));
  await vi.advanceTimersByTimeAsync(35_000); expect(socket.close).toHaveBeenCalled();
});

it("bounds output, pauses a slow consumer and resumes after draining", async () => {
  const socket = await connect();
  expect(state.options.maxPayload).toBe(64 * 1024);
  socket.bufferedAmount = 2 * 1024 * 1024; state.stream.emit("data", Buffer.from("output"));
  expect(state.stream.pause).toHaveBeenCalled();
  socket.bufferedAmount = 0; await vi.advanceTimersByTimeAsync(125); expect(state.stream.resume).toHaveBeenCalled();
  socket.bufferedAmount = 5 * 1024 * 1024; state.stream.emit("data", Buffer.from("output"));
  expect(socket.close).toHaveBeenCalledWith(1013, expect.any(String));
});

it("rejects malformed resize input before writing to SSH", async () => {
  const socket = await connect();
  socket.emit("message", Buffer.from(JSON.stringify({ type: "resize", rows: -1, cols: 80 })), false);
  expect(socket.close).toHaveBeenCalled(); expect(state.stream.write).not.toHaveBeenCalled();
});

it("accepts valid input while the account and node remain authorized", async () => {
  const socket = await connect();
  socket.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "YXVkaXQ=" })), false);
  await vi.advanceTimersByTimeAsync(0);
  expect(state.stream.write).toHaveBeenCalledWith(Buffer.from("audit"));
  expect(socket.close).not.toHaveBeenCalled();
});

it.each(["binary", "oversized", "invalid-base64"])("rejects %s input before SSH writes", async (kind) => {
  const socket = await connect();
  const message = kind === "oversized" ? Buffer.alloc(65 * 1024) : Buffer.from(JSON.stringify({ type: "input", data: kind === "invalid-base64" ? "bad%!" : "YQ==" }));
  socket.emit("message", message, kind === "binary");
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.close).toHaveBeenCalled();
  expect(state.stream.write).not.toHaveBeenCalled();
});

it("closes an existing terminal when its endpoint or credentials change", async () => {
  const socket = await connect();
  const original = await state.server();
  state.server.mockResolvedValue({ ...original, host: "192.0.2.99" });
  await vi.advanceTimersByTimeAsync(30_000);
  expect(socket.close).toHaveBeenCalled();
});

it("limits each user's active terminals and releases slots after close", async () => {
  const sockets = [];
  for (let i = 0; i < 8; i++) sockets.push(await connect());
  const rejected = await connect(false);
  expect(rejected.close).toHaveBeenCalledWith(1013, expect.any(String));
  sockets[0]!.close();
  const replacement = await connect();
  expect(replacement.close).not.toHaveBeenCalled();
});

it("limits total active terminals across different users", async () => {
  const session = await state.verify();
  for (let i = 0; i < 64; i++) {
    state.handshakeUserId = `audit-user-${i}`;
    state.verify.mockResolvedValue({ ...session, userId: state.handshakeUserId });
    await connect();
  }
  state.handshakeUserId = "audit-user-overflow";
  state.verify.mockResolvedValue({ ...session, userId: state.handshakeUserId });
  const rejected = await connect(false);
  expect(rejected.close).toHaveBeenCalledWith(1013, expect.any(String));
  expect(state.clients.size).toBe(64);
});
