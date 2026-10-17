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
  deferReady: null as null | (() => void),
  shellOptions: [] as unknown[],
  client: undefined as unknown as import("node:events").EventEmitter,
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
    connect() {
      state.client = this;
      if (state.deferReady === null) this.emit("ready");
      else state.deferReady = () => this.emit("ready");
    }
    shell(options: unknown, callback: (error: null, stream: unknown) => void) {
      state.shellOptions.push(options);
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
vi.mock("@/lib/ssh/ssh-key-crypto", async () => (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({ decryptServerPassword: (v: string) => v, decryptSshPrivateKey: (v: string) => v, decryptSshKeyPassphrase: (v: string) => v }));
vi.mock("@/lib/ssh/client", () => ({ createVerifiedSshConfig: (v: unknown) => v }));
vi.mock("@/lib/rdp/ws", () => ({ setupRdpWebSocket: () => () => undefined }));
vi.mock("@/lib/runtime-settings/service", () => ({ getSshTerminalRuntimeConfig: async () => ({ wsHeartbeatIntervalMs: 30_000, sshIdleTimeoutMs: 0 }) }));

const initialProcessListeners = new Map<string, ReturnType<typeof process.listeners>>();
beforeEach(() => {
  for (const event of ["SIGINT", "SIGTERM", "uncaughtException", "unhandledRejection"]) initialProcessListeners.set(event, process.listeners(event));
  vi.resetModules(); vi.useFakeTimers(); state.clients.clear(); state.verify.mockReset(); state.server.mockReset();
  state.handshakeUserId = "audit-user";
  state.deferReady = null;
  state.shellOptions = [];
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

async function connect(expectConnected = true, query = "") {
  await import("../ssh-ws-proxy");
  const socket = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(), ping: vi.fn(), terminate: vi.fn() });
  socket.close.mockImplementation(() => { socket.readyState = 3; state.clients.delete(socket); socket.emit("close"); });
  socket.ping.mockImplementation(() => socket.emit("pong"));
  state.clients.add(socket);
  await state.connection(socket, { url: `/ssh?serverId=audit-server&handshake=fixture${query}`, headers: { origin: "http://127.0.0.1:15430", cookie: "audit_session=fixture-cookie" } });
  if (expectConnected) expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "connected", inputAck: true, heartbeat: true }));
  return socket;
}

/** The `session` message the proxy sends right after `connected`. */
function sessionMessage(socket: { send: ReturnType<typeof vi.fn> }) {
  const raw = socket.send.mock.calls.map((call) => String(call[0])).find((text) => text.includes('"type":"session"'));
  return raw ? JSON.parse(raw) as { type: "session"; resumeId: string | null; resumed: boolean; keepAliveMs: number; offset: number; replayTruncated: boolean } : null;
}

function outputMessages(socket: { send: ReturnType<typeof vi.fn> }) {
  return socket.send.mock.calls.map((call) => JSON.parse(String(call[0]))).filter((m) => m.type === "output").map((m) => Buffer.from(m.data, "base64").toString());
}

it("stops an already connected shell after account/session revocation", async () => {
  const { AuthError } = await import("@/lib/errors");
  const socket = await connect(true, "&keepAlive=1");
  const stream = state.stream;
  state.verify.mockRejectedValue(new AuthError("Session revoked"));
  await vi.advanceTimersByTimeAsync(30_000);
  socket.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "YXVkaXQ=" })), false);
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.close).toHaveBeenCalledWith(1008, expect.any(String)); expect(state.stream.write).not.toHaveBeenCalled();
  // A verdict ends even a kept shell, and the browser is told not to retry.
  expect(stream.close).toHaveBeenCalled();
  expect(frames(socket).find((frame) => frame.type === "error")).toMatchObject({ fatal: true });
});

it("stops on revoked node access", async () => {
  const socket = await connect(); state.server.mockResolvedValue(null);
  await vi.advanceTimersByTimeAsync(30_000); expect(socket.close).toHaveBeenCalled();
});

it("fails closed when authorization cannot be refreshed within its deadline", async () => {
  const socket = await connect(); state.verify.mockImplementation(() => new Promise(() => undefined));
  await vi.advanceTimersByTimeAsync(35_000); expect(socket.close).toHaveBeenCalled();
});

it("keeps a kept shell when the authorization check is only unavailable, and resumes it once checks pass", async () => {
  const socket = await connect(true, "&keepAlive=1");
  const { resumeId } = sessionMessage(socket)!;
  const stream = state.stream;
  const healthy = state.verify.getMockImplementation();
  state.verify.mockRejectedValue(new Error("database is restarting"));
  await vi.advanceTimersByTimeAsync(30_000);
  expect(socket.close).toHaveBeenCalledWith(1011, expect.any(String));
  expect(frames(socket).find((frame) => frame.type === "error")).toBeUndefined();
  expect(stream.close).not.toHaveBeenCalled();
  state.verify.mockImplementation(healthy!);
  const again = await connect(true, `&keepAlive=1&resume=${resumeId}&offset=0`);
  expect(sessionMessage(again)?.resumed).toBe(true);
  expect(state.stream).toBe(stream);
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

it("opens the PTY at the size the browser sent before SSH authentication finished", async () => {
  // The browser reports its grid as soon as the socket opens; the SSH shell
  // only exists after authentication. That first resize used to be dropped,
  // so the shell started at 80x24 while the browser showed another grid.
  state.deferReady = () => undefined;
  const socket = await connect(false);
  socket.emit("message", Buffer.from(JSON.stringify({ type: "resize", rows: 17, cols: 116 })), false);
  await vi.advanceTimersByTimeAsync(0);
  expect(state.shellOptions).toEqual([]);
  state.deferReady!();
  await vi.advanceTimersByTimeAsync(0);
  expect(state.shellOptions).toEqual([{ term: "xterm-256color", rows: 17, cols: 116 }]);
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "connected", inputAck: true, heartbeat: true }));
  socket.emit("message", Buffer.from(JSON.stringify({ type: "resize", rows: 30, cols: 100 })), false);
  await vi.advanceTimersByTimeAsync(0);
  expect((state.stream as unknown as { setWindow: ReturnType<typeof vi.fn> }).setWindow).toHaveBeenLastCalledWith(30, 100, 0, 0);
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

it("acknowledges sequenced input only after the SSH writer accepts it", async () => {
  const socket = await connect();
  socket.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "YXVkaXQ=", id: 1 })), false);
  await vi.advanceTimersByTimeAsync(0);
  expect(state.stream.write).toHaveBeenCalledWith(Buffer.from("audit"), expect.any(Function));
  const accepted = state.stream.write.mock.calls[0]![1] as (error?: Error) => void;
  expect(socket.send).not.toHaveBeenCalledWith(JSON.stringify({ type: "input-ack", id: 1 }));
  accepted();
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: "input-ack", id: 1 }));
});

it("closes on an SSH write failure without falsely acknowledging the command", async () => {
  const socket = await connect();
  state.stream.write.mockImplementation((_bytes: Buffer, callback: (error: Error) => void) => callback(new Error("Closed")));
  socket.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "YXVkaXQ=", id: 1 })), false);
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.close).toHaveBeenCalled();
  expect(socket.send).not.toHaveBeenCalledWith(JSON.stringify({ type: "input-ack", id: 1 }));
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

it("ends the shell with the socket unless the terminal opted into keep-alive", async () => {
  const socket = await connect();
  expect(sessionMessage(socket)).toEqual({ type: "session", resumeId: null, resumed: false, keepAliveMs: 0, offset: 0, replayTruncated: false });
  socket.close();
  expect(state.stream.close).toHaveBeenCalled();
});

it("keeps an opted-in shell alive across a dropped socket and replays what it printed", async () => {
  const first = await connect(true, "&keepAlive=1");
  const announced = sessionMessage(first);
  expect(announced?.resumed).toBe(false);
  expect(announced?.resumeId).toMatch(/^[0-9a-f]{32}$/);
  expect(announced?.keepAliveMs).toBe(10 * 60_000);
  const stream = state.stream;

  first.close();
  expect(stream.close).not.toHaveBeenCalled();
  stream.emit("data", Buffer.from("still running\n"));

  const second = await connect(true, `&keepAlive=1&resume=${announced!.resumeId}`);
  expect(sessionMessage(second)).toEqual({ type: "session", resumeId: announced!.resumeId, resumed: true, keepAliveMs: 10 * 60_000, offset: 0, replayTruncated: false });
  expect(outputMessages(second)).toEqual(["still running\n"]);
  expect(state.stream).toBe(stream);

  // Input and output continue on the same shell.
  second.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "YXVkaXQ=" })), false);
  await vi.advanceTimersByTimeAsync(0);
  expect(stream.write).toHaveBeenCalledWith(Buffer.from("audit"));
  stream.emit("data", Buffer.from("later\n"));
  expect(outputMessages(second)).toEqual(["still running\n", "later\n"]);
});

it("drops a detached shell once the grace period runs out", async () => {
  const socket = await connect(true, "&keepAlive=1");
  const { resumeId } = sessionMessage(socket)!;
  const stream = state.stream;
  socket.close();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(stream.close).toHaveBeenCalled();

  const replacement = await connect(true, `&keepAlive=1&resume=${resumeId}`);
  expect(sessionMessage(replacement)?.resumed).toBe(false);
  expect(state.stream).not.toBe(stream);
});

it("never hands a detached shell to another account", async () => {
  const socket = await connect(true, "&keepAlive=1");
  const { resumeId } = sessionMessage(socket)!;
  const stream = state.stream;
  socket.close();

  const session = await state.verify();
  state.handshakeUserId = "audit-user-2";
  state.verify.mockResolvedValue({ ...session, userId: "audit-user-2" });
  const other = await connect(true, `&keepAlive=1&resume=${resumeId}`);
  expect(sessionMessage(other)?.resumed).toBe(false);
  expect(state.stream).not.toBe(stream);
  expect(stream.close).not.toHaveBeenCalled();
});

it("ends a detached shell when the remote side closes it", async () => {
  const socket = await connect(true, "&keepAlive=1");
  const { resumeId } = sessionMessage(socket)!;
  const stream = state.stream;
  socket.close();
  stream.emit("close");

  const replacement = await connect(true, `&keepAlive=1&resume=${resumeId}`);
  expect(sessionMessage(replacement)?.resumed).toBe(false);
});

/** Parsed frames the proxy sent on a socket. */
function frames(socket: { send: ReturnType<typeof vi.fn> }) {
  return socket.send.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

it("tells the browser a shell that exited ended on purpose, with its exit code", async () => {
  const socket = await connect(true, "&keepAlive=1");
  state.stream.emit("exit", 0);
  state.stream.emit("close");
  const closed = frames(socket).find((frame) => frame.type === "closed");
  expect(closed).toMatchObject({ type: "closed", reason: "exit" });
  expect(String(closed?.data)).toContain("0");
  expect(socket.close).toHaveBeenCalled();
});

it("reports a shell ended by a signal as an exit too", async () => {
  const socket = await connect(true, "&keepAlive=1");
  state.stream.emit("exit", null, "KILL", false, "");
  state.stream.emit("close");
  const closed = frames(socket).find((frame) => frame.type === "closed");
  expect(closed).toMatchObject({ reason: "exit" });
  expect(String(closed?.data)).toContain("KILL");
});

it("reports a dropped SSH connection as lost, once, so the browser retries", async () => {
  const socket = await connect(true, "&keepAlive=1");
  state.client.emit("end");
  state.client.emit("close");
  const closed = frames(socket).filter((frame) => frame.type === "closed");
  expect(closed).toHaveLength(1);
  expect(closed[0]).toMatchObject({ reason: "lost" });
});

it("marks refusals a retry cannot change as fatal", async () => {
  state.verify.mockResolvedValue({ userId: "audit-user", username: "audit", roles: ["viewer"], permissions: [], currentTeamId: "audit-team", mustChangePassword: false });
  const socket = await connect(false);
  expect(frames(socket).find((frame) => frame.type === "error")).toMatchObject({ fatal: true });
});

it("replays only the end of an overflowing detach buffer, from a line start, and says so", async () => {
  const first = await connect(true, "&keepAlive=1");
  const { resumeId } = sessionMessage(first)!;
  const stream = state.stream;
  first.close();
  // 300 KiB of output while nobody watches; each chunk starts mid-sequence.
  const line = "\x1b[1;32mok\x1b[0m " + "x".repeat(60) + "\n";
  for (let index = 0; index < 5_000; index += 1) stream.emit("data", Buffer.from(line.slice(3) + line.slice(0, 3)));
  const second = await connect(true, `&keepAlive=1&resume=${resumeId}`);
  expect(sessionMessage(second)).toMatchObject({ resumed: true, replayTruncated: true });
  const replay = outputMessages(second).join("");
  expect(replay.length).toBeLessThanOrEqual(256 * 1024);
  expect(replay.startsWith("1;32mok")).toBe(false);
  expect(replay.charCodeAt(0)).not.toBe(0x0a);
});

it("finds a safe replay start: after a line break, else at an escape, else at a character boundary", async () => {
  const { safeReplayStart } = await import("../ssh-ws-proxy");
  expect(safeReplayStart(Buffer.from("049h partial\nnext line"))).toBe("049h partial\n".length);
  expect(safeReplayStart(Buffer.from("049h\x1b[2Jdrawn"))).toBe(4);
  const chinese = Buffer.from("中文");
  expect(safeReplayStart(chinese.subarray(1))).toBe(2);
  expect(safeReplayStart(Buffer.alloc(0))).toBe(0);
});

it("classifies SSH failures a retry cannot fix", async () => {
  const { isPermanentTerminalSshError } = await import("../ssh-ws-proxy");
  expect(isPermanentTerminalSshError(new Error("All configured authentication methods failed"))).toBe(true);
  expect(isPermanentTerminalSshError(new Error("Host key verification failed"))).toBe(true);
  expect(isPermanentTerminalSshError(new Error("connect ECONNREFUSED 192.0.2.2:22"))).toBe(false);
  expect(isPermanentTerminalSshError(new Error("Timed out while waiting for handshake"))).toBe(false);
});

/** A socket that looks open to the proxy but whose browser is gone (a silent network drop). */
async function connectKept(query = "") {
  const socket = await connect(true, `&keepAlive=1${query}`);
  return { socket, session: sessionMessage(socket)!, stream: state.stream };
}

it("lets a reconnect take its shell over from a socket that still looks open", async () => {
  const { socket: first, session, stream } = await connectKept();
  stream.emit("data", Buffer.from("one\n"));
  // The browser lost its connection without a close; it reconnects with what it has.
  const second = await connect(true, `&keepAlive=1&resume=${session.resumeId}&offset=4`);
  expect(sessionMessage(second)).toMatchObject({ resumed: true, offset: 4, replayTruncated: false });
  expect(outputMessages(second)).toEqual([]);
  expect(frames(first).find((frame) => frame.type === "closed")).toMatchObject({ reason: "replaced" });
  expect(first.close).toHaveBeenCalledWith(4001, expect.any(String));
  expect(stream.close).not.toHaveBeenCalled();
  // Output and input now belong to the new socket only.
  stream.emit("data", Buffer.from("two\n"));
  expect(outputMessages(second)).toEqual(["two\n"]);
  expect(outputMessages(first)).toEqual(["one\n"]);
  second.emit("message", Buffer.from(JSON.stringify({ type: "input", data: "YXVkaXQ=" })), false);
  await vi.advanceTimersByTimeAsync(0);
  expect(stream.write).toHaveBeenCalledWith(Buffer.from("audit"));
});

it("cuts a replaced socket that never finishes closing", async () => {
  const { socket: first, session } = await connectKept();
  first.close.mockImplementation(() => undefined);
  await connect(true, `&keepAlive=1&resume=${session.resumeId}&offset=0`);
  expect(first.terminate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5_000);
  expect(first.terminate).toHaveBeenCalled();
});

it("replays exactly what the browser missed, from the offset it reports", async () => {
  const { socket: first, session, stream } = await connectKept();
  stream.emit("data", Buffer.from("one\n"));
  stream.emit("data", Buffer.from("two\n"));
  stream.emit("data", Buffer.from("three\n"));
  first.close();
  stream.emit("data", Buffer.from("four\n"));
  // The browser saw "one\n" only: the rest of the history follows, in order.
  const second = await connect(true, `&keepAlive=1&resume=${session.resumeId}&offset=4`);
  expect(sessionMessage(second)).toMatchObject({ resumed: true, offset: 4, replayTruncated: false });
  expect(outputMessages(second).join("")).toBe("two\nthree\nfour\n");
});

it("gives a reloaded page (offset 0) all the history there is", async () => {
  const { socket: first, session, stream } = await connectKept();
  stream.emit("data", Buffer.from("prompt$ ls\n"));
  first.close();
  const reloaded = await connect(true, `&keepAlive=1&resume=${session.resumeId}&offset=0`);
  expect(sessionMessage(reloaded)).toMatchObject({ resumed: true, offset: 0, replayTruncated: false });
  expect(outputMessages(reloaded).join("")).toBe("prompt$ ls\n");
});

it("starts the replay at a safe point and says so when the history no longer reaches the browser's offset", async () => {
  const { socket: first, session, stream } = await connectKept();
  const line = "\x1b[1;32mok\x1b[0m " + "x".repeat(60) + "\n";
  for (let index = 0; index < 5_000; index += 1) stream.emit("data", Buffer.from(line.slice(3) + line.slice(0, 3)));
  first.close();
  const second = await connect(true, `&keepAlive=1&resume=${session.resumeId}&offset=10`);
  const announced = sessionMessage(second)!;
  expect(announced).toMatchObject({ resumed: true, replayTruncated: true });
  const replay = outputMessages(second).join("");
  // The offset names the first replayed byte: the browser keeps counting from there.
  expect(announced.offset + Buffer.byteLength(replay)).toBe(5_000 * Buffer.byteLength(line));
  expect(Buffer.byteLength(replay)).toBeLessThanOrEqual(256 * 1024);
  expect(replay.startsWith("1;32mok")).toBe(false);
});

it("resumes output a backed-up socket had paused, on detach and on takeover", async () => {
  const { socket: first, session, stream } = await connectKept();
  first.bufferedAmount = 2 * 1024 * 1024;
  stream.emit("data", Buffer.from("burst"));
  expect(stream.pause).toHaveBeenCalledTimes(1);
  // Taken over while paused: the new socket starts drained.
  await connect(true, `&keepAlive=1&resume=${session.resumeId}&offset=5`);
  expect(stream.resume).toHaveBeenCalledTimes(1);
});

it("lets a detached program keep running instead of staying paused", async () => {
  const { socket: first, stream } = await connectKept();
  first.bufferedAmount = 2 * 1024 * 1024;
  stream.emit("data", Buffer.from("burst"));
  expect(stream.pause).toHaveBeenCalledTimes(1);
  first.close();
  expect(stream.resume).toHaveBeenCalledTimes(1);
  expect(stream.close).not.toHaveBeenCalled();
});

it("keeps a keep-alive shell when the socket's send queue overflows", async () => {
  const { socket: first, session, stream } = await connectKept();
  first.bufferedAmount = 5 * 1024 * 1024;
  stream.emit("data", Buffer.from("too much"));
  expect(first.close).toHaveBeenCalledWith(1013, expect.any(String));
  expect(stream.close).not.toHaveBeenCalled();
  const second = await connect(true, `&keepAlive=1&resume=${session.resumeId}&offset=0`);
  expect(sessionMessage(second)?.resumed).toBe(true);
  expect(outputMessages(second).join("")).toBe("too much");
});

it("answers pings at once without counting them as shell activity", async () => {
  const socket = await connect(true, "&keepAlive=1");
  socket.emit("message", Buffer.from(JSON.stringify({ type: "ping", id: 7 })), false);
  expect(frames(socket).at(-1)).toEqual({ type: "pong", id: 7 });
  expect(state.stream.write).not.toHaveBeenCalled();
  socket.emit("message", Buffer.from(JSON.stringify({ type: "ping", id: -1 })), false);
  expect(socket.close).toHaveBeenCalled();
});

it("ends a kept shell when the user closes the terminal", async () => {
  const { socket, session, stream } = await connectKept();
  socket.emit("message", Buffer.from(JSON.stringify({ type: "end" })), false);
  expect(stream.close).toHaveBeenCalled();
  expect(socket.close).toHaveBeenCalledWith(1000, expect.any(String));
  const next = await connect(true, `&keepAlive=1&resume=${session.resumeId}&offset=0`);
  expect(sessionMessage(next)?.resumed).toBe(false);
});

it("plans replays from the reported offset, the detach point, or the oldest kept byte", async () => {
  const { planShellReplay } = await import("../ssh-ws-proxy");
  const history = { start: 100, end: 500 };
  expect(planShellReplay(history, 300, null)).toEqual({ from: 300, truncated: false });
  expect(planShellReplay(history, 500, null)).toEqual({ from: 500, truncated: false });
  expect(planShellReplay(history, 900, null)).toEqual({ from: 500, truncated: false });
  expect(planShellReplay(history, 50, null)).toEqual({ from: 100, truncated: true });
  // An older browser reports nothing: continue from where the socket was lost.
  expect(planShellReplay(history, null, 450)).toEqual({ from: 450, truncated: false });
  expect(planShellReplay(history, null, 20)).toEqual({ from: 100, truncated: true });
  expect(planShellReplay(history, null, null)).toEqual({ from: 500, truncated: false });
});
