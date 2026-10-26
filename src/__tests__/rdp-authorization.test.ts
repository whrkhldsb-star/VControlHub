// @vitest-environment node
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instruction } from "@/lib/rdp/protocol";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getServer: vi.fn(), tunnel: vi.fn(), webSocketServer: vi.fn(), clipboard: vi.fn(), audit: vi.fn(async () => undefined) }));
vi.mock("ws", () => ({
  WebSocket: { OPEN: 1 },
  WebSocketServer: class { constructor() { return mocks.webSocketServer(); } },
}));
vi.mock("node:net", () => ({ createConnection: () => mocks.tunnel() }));
vi.mock("@/lib/auth/session", () => ({ getSessionCookieName: () => "session", verifySessionToken: mocks.verify }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => true }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.audit }));
vi.mock("@/lib/crypto/service", () => ({ decrypt: () => "isolated-password" }));
vi.mock("@/lib/rdp/certificate", () => ({ rdpCertificateOptions: () => ({}) }));
vi.mock("@/lib/rdp/tickets", () => ({
  checkGuacd: async () => undefined, consumeRdpTicket: () => mocks.getServer(), getRdpServer: mocks.getServer,
  guacdPort: () => 4822, rdpEndpointHash: () => "endpoint", rdpOriginAllowed: () => true,
}));
vi.mock("@/lib/runtime-settings/service", () => ({ getRdpSessionRuntimeConfig: async () => ({ idleTimeoutMs: 0, maxSessionMs: 0 }) }));
vi.mock("@/lib/rdp/features", () => ({ rdpAudioEnabled: () => false, rdpClipboardEnabled: mocks.clipboard, RDP_AUDIO_MIMETYPES: [] }));

import { setupRdpWebSocket } from "@/lib/rdp/ws";

describe("established RDP authorization", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.clipboard.mockReturnValue(false);
    mocks.verify.mockResolvedValue({ userId: "u", roles: ["admin"], currentTeamId: "t", mustChangePassword: false });
    mocks.getServer.mockResolvedValue({ id: "s", teamId: "t", host: "192.0.2.1", port: 3389, username: "test", rdpPassword: "sealed" });
  });
  afterEach(() => { stop?.(); vi.useRealTimers(); });

  async function connect(handshake = instruction("args") + instruction("ready", "tunnel")) {
    const tunnel = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), destroy: vi.fn(), pause: vi.fn(), resume: vi.fn(), writable: true, connecting: false, destroyed: false });
    mocks.tunnel.mockReturnValue(tunnel);
    const wss = Object.assign(new EventEmitter(), { clients: new Set(), close: vi.fn() });
    mocks.webSocketServer.mockReturnValue(wss);
    const ws = Object.assign(new EventEmitter(), {
      readyState: 1, bufferedAmount: 0, send: vi.fn(), ping: vi.fn(() => { ws.emit("pong"); }),
      close: vi.fn(() => { ws.readyState = 3; ws.emit("close"); }),
      terminate: () => { ws.close(); },
    });
    wss.clients.add(ws);
    stop = setupRdpWebSocket(new EventEmitter() as Server);
    wss.emit("connection", ws, { headers: { cookie: "session=authenticated", origin: "https://hub.test" } });
    await ws.listeners("message")[0]!(Buffer.from("single-use-ticket"), false);
    tunnel.emit("data", Buffer.from(handshake));
    expect(ws.close).not.toHaveBeenCalled();
    return { ws, tunnel };
  }

  it("audits why a connection failed, once", async () => {
    // The audit kept only the server, and a handshake failure counted twice.
    const failed = () => mocks.audit.mock.calls.filter((call) => (call as unknown[])[1] === "server.rdp.failed");
    const refused = await connect();
    refused.tunnel.emit("data", Buffer.from(instruction("error", "Authentication failure (invalid credentials?)", "769")));
    expect(failed()).toEqual([["u", "server.rdp.failed", { serverId: "s", status: "769", message: "Authentication failure (invalid credentials?)" }, undefined, "t"]]);
    stop?.();

    mocks.audit.mockClear();
    const unreachable = await connect(instruction("args"));
    unreachable.tunnel.emit("data", Buffer.from(instruction("error", "Upstream not found", "519")));
    expect(unreachable.ws.close).toHaveBeenCalled();
    expect(failed()).toEqual([["u", "server.rdp.failed", { serverId: "s", status: "519", message: "Upstream not found" }, undefined, "t"]]);
  });

  it("tells the browser when Windows refuses the account, and keeps other failures generic", async () => {
    // guacd: error,<message>,<status>; Windows' refusal arrives after "ready".
    for (const [status, sent] of [["769", "769"], ["771", "771"], ["519", "512"]] as const) {
      const { ws, tunnel } = await connect();
      tunnel.emit("data", Buffer.from(instruction("error", "Authentication failure (invalid credentials?)", status)));
      expect(ws.send).toHaveBeenLastCalledWith(expect.stringMatching(new RegExp(`,3\\.${sent};$`)));
      expect(ws.close).toHaveBeenCalled();
      stop?.();
    }
  });

  it("resets the clipboard transfer budget for each completed paste", async () => {
    mocks.clipboard.mockReturnValue(true);
    const { ws, tunnel } = await connect();
    for (let paste = 0; paste < 300; paste++) {
      ws.emit("message", Buffer.from(instruction("clipboard", "0", "text/plain") + instruction("blob", "0", "YQ==") + instruction("end", "0")), false);
    }
    expect(ws.close).not.toHaveBeenCalled();
    expect(tunnel.write).toHaveBeenCalledWith(instruction("end", "0"));
  });
  it("still rejects a single oversized transfer and duplicate open stream IDs", async () => {
    mocks.clipboard.mockReturnValue(true);
    const { ws } = await connect();
    ws.emit("message", Buffer.from(instruction("clipboard", "0", "text/plain")), false);
    for (let chunk = 0; chunk < 257; chunk++) ws.emit("message", Buffer.from(instruction("blob", "0", "YQ==")), false);
    expect(ws.close).toHaveBeenCalledWith(1008);
    const other = await connect();
    other.ws.emit("message", Buffer.from(instruction("clipboard", "0", "text/plain").repeat(2)), false);
    expect(other.ws.close).toHaveBeenCalledWith(1008);
  });

  it("closes the tunnel when an authorization lookup stalls, even with unlimited idle policy", async () => {
    const { ws, tunnel } = await connect();
    mocks.verify.mockImplementation(() => new Promise<never>(() => undefined));
    await vi.advanceTimersByTimeAsync(10_001);
    expect(ws.close).toHaveBeenCalledWith(1008);
    expect(tunnel.end).toHaveBeenCalledWith(instruction("disconnect"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tunnel.destroy).toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledTimes(2);
  });

  it("sends one guacd chunk to the browser as one message", async () => {
    // One message per instruction meant thousands a second while the screen
    // changed, each with its own frame and Cloudflare handling.
    const { ws, tunnel } = await connect();
    ws.send.mockClear();
    const chunk = instruction("size", "0", "1280", "720") + instruction("rect", "0", "0", "0", "10", "10") + instruction("sync", "1");
    tunnel.emit("data", Buffer.from(chunk));
    expect(ws.send.mock.calls).toEqual([[chunk]]);
  });

  it("holds guacd back once 1 MB waits for the browser, and lets it go as soon as that drains", async () => {
    // 4 MB used to queue in front of every click (10 s and more on a slow
    // path), and a held stream resumed only on the 5-second tick.
    const { ws, tunnel } = await connect();
    ws.bufferedAmount = 1_500_000;
    tunnel.emit("data", Buffer.from(instruction("sync", "1")));
    expect(tunnel.pause).toHaveBeenCalledTimes(1);
    ws.bufferedAmount = 100_000;
    await vi.advanceTimersByTimeAsync(150);
    expect(tunnel.resume).toHaveBeenCalledTimes(1);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("holds guacd back while a frame left 1.5 s ago is undrawn, until the browser is within 0.5 s", async () => {
    // guacd paced itself only by how much the browser's answers slowed from
    // frame to frame: a queue growing in the kernel, Caddy and Cloudflare
    // read to it as a longer path, and the desktop fell ever further behind.
    const { ws, tunnel } = await connect();
    const rect = instruction("rect", "0", "0", "0", "10", "10");
    tunnel.emit("data", Buffer.from(rect + instruction("sync", "1000")));
    await vi.advanceTimersByTimeAsync(1_000);
    tunnel.emit("data", Buffer.from(rect + instruction("sync", "2000")));
    expect(tunnel.pause).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    tunnel.emit("data", Buffer.from(rect));
    expect(tunnel.pause).toHaveBeenCalledTimes(1);
    // The older frame drawn, the newer one has waited 600 ms: still held.
    ws.emit("message", Buffer.from(instruction("sync", "1000")), false);
    await vi.advanceTimersByTimeAsync(150);
    expect(tunnel.resume).not.toHaveBeenCalled();
    // Caught up: guacd goes on at once, and the answers still reach it.
    ws.emit("message", Buffer.from(instruction("sync", "2000")), false);
    expect(tunnel.resume).toHaveBeenCalledTimes(1);
    expect(tunnel.write).toHaveBeenCalledWith(instruction("sync", "2000"));
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("keeps guacd flowing for a browser that draws each frame in time", async () => {
    const { ws, tunnel } = await connect();
    for (let frame = 1; frame <= 20; frame += 1) {
      tunnel.emit("data", Buffer.from(instruction("sync", String(frame * 1000))));
      await vi.advanceTimersByTimeAsync(400);
      ws.emit("message", Buffer.from(instruction("sync", String(frame * 1000))), false);
    }
    expect(tunnel.pause).not.toHaveBeenCalled();
  });

  it("never waits for a frame the browser will not answer", async () => {
    const { ws, tunnel } = await connect();
    // The browser answers each timestamp once; guacd may end two frames with one.
    tunnel.emit("data", Buffer.from(instruction("sync", "5")));
    ws.emit("message", Buffer.from(instruction("sync", "5")), false);
    tunnel.emit("data", Buffer.from(instruction("sync", "5")));
    await vi.advanceTimersByTimeAsync(2_000);
    tunnel.emit("data", Buffer.from(instruction("rect", "0", "0", "0", "10", "10")));
    expect(tunnel.pause).not.toHaveBeenCalled();
    // A frame left unanswered for 30 s is given up on, so guacd is not held forever.
    tunnel.emit("data", Buffer.from(instruction("sync", "9")));
    await vi.advanceTimersByTimeAsync(1_600);
    tunnel.emit("data", Buffer.from(instruction("rect", "0", "0", "0", "10", "10")));
    expect(tunnel.pause).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(tunnel.resume).toHaveBeenCalledTimes(1);
  });

  it("retains a healthy session across repeated authorization checks", async () => {
    const { ws } = await connect();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(ws.close).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalledTimes(5);
  });
});

describe("ending an RDP session", () => {
  let stop: (() => void) | undefined;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.clipboard.mockReturnValue(false);
    mocks.verify.mockResolvedValue({ userId: "u", roles: ["admin"], currentTeamId: "t", mustChangePassword: false });
    mocks.getServer.mockResolvedValue({ id: "s", teamId: "t", host: "192.0.2.1", port: 3389, username: "test", rdpPassword: "sealed" });
  });
  afterEach(() => { stop?.(); vi.useRealTimers(); });

  async function live() {
    const tunnel = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), destroy: vi.fn(), pause: vi.fn(), resume: vi.fn(), writable: true, connecting: false, destroyed: false });
    mocks.tunnel.mockReturnValue(tunnel);
    const wss = Object.assign(new EventEmitter(), { clients: new Set(), close: vi.fn() });
    mocks.webSocketServer.mockReturnValue(wss);
    const ws = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0, send: vi.fn(), ping: vi.fn(() => { ws.emit("pong"); }), close: vi.fn(() => { ws.readyState = 3; ws.emit("close", 1000); }), terminate: () => ws.close() });
    stop = setupRdpWebSocket(new EventEmitter() as Server);
    wss.emit("connection", ws, { headers: { cookie: "session=authenticated", origin: "https://hub.test" } });
    await ws.listeners("message")[0]!(Buffer.from("single-use-ticket"), false);
    tunnel.emit("data", Buffer.from(instruction("args") + instruction("ready", "tunnel")));
    return { ws, tunnel };
  }

  it("tells guacd the user left, so Windows releases the session at once", async () => {
    // guacd behind the rootless Docker port proxy did not always see a closed
    // socket and stayed signed in to Windows for 15 s; a reconnect then had
    // to take the session over from it.
    const { ws, tunnel } = await live();
    ws.readyState = 3;
    ws.emit("close", 1006);
    expect(tunnel.end).toHaveBeenCalledWith(instruction("disconnect"));
    expect(tunnel.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(tunnel.destroy).toHaveBeenCalled();
    // Why it ended goes into the audit: here the connection was lost.
    expect(mocks.audit).toHaveBeenCalledWith("u", "server.rdp.closed", { serverId: "s", reason: "browser: 1006", seconds: "0" }, undefined, "t");
  });

  it("forwards the browser's own disconnect to guacd", async () => {
    const { ws, tunnel } = await live();
    ws.emit("message", Buffer.from(instruction("disconnect")), false);
    expect(tunnel.end).toHaveBeenCalledWith(instruction("disconnect"));
    expect(mocks.audit).toHaveBeenCalledWith("u", "server.rdp.closed", expect.objectContaining({ reason: "browser: disconnect" }), undefined, "t");
  });

  it("keeps the session when the browser sends a pointer just off the desktop's edge", async () => {
    // A desktop centred on a half pixel reports -1 at its edge in Chromium and
    // WebKit; that one move used to end the session ("Unsupported RDP input").
    const { ws, tunnel } = await live();
    ws.emit("message", Buffer.from(instruction("mouse", "-1", "-2", "0") + instruction("mouse", "10.5", "20", "1")), false);
    expect(ws.close).not.toHaveBeenCalled();
    expect(tunnel.write).toHaveBeenCalledWith(instruction("mouse", "0", "0", "0"));
    expect(tunnel.write).toHaveBeenCalledWith(instruction("mouse", "10", "20", "1"));
  });

  it("drops a stray malformed instruction without forwarding it, but closes on a flood", async () => {
    const { ws, tunnel } = await live();
    ws.emit("message", Buffer.from(instruction("mouse", "NaN", "1", "0") + instruction("size", "0", "0") + instruction("argv", "1", "x", "y")), false);
    expect(ws.close).not.toHaveBeenCalled();
    expect(tunnel.write).not.toHaveBeenCalledWith(expect.stringContaining("NaN"));
    expect(tunnel.write).not.toHaveBeenCalledWith(instruction("size", "0", "0"));
    expect(tunnel.write).not.toHaveBeenCalledWith(expect.stringContaining("argv"));
    // Spread over minutes they never add up…
    for (let minute = 0; minute < 3; minute++) {
      await vi.advanceTimersByTimeAsync(61_000);
      ws.emit("message", Buffer.from(instruction("size", "0", "0").repeat(40)), false);
    }
    expect(ws.close).not.toHaveBeenCalled();
    // …but a browser sending little else is not a desktop in use.
    ws.emit("message", Buffer.from(instruction("size", "0", "0").repeat(20)), false);
    expect(ws.close).toHaveBeenCalledWith(1008);
    expect(mocks.audit).toHaveBeenCalledWith("u", "server.rdp.closed", expect.objectContaining({ reason: "gateway: Unsupported RDP input (size)" }), undefined, "t");
  });

  it("passes on when Windows ended the session itself, so the browser does not take it back", async () => {
    for (const [status, sent] of [["521", "3.521"], ["523", "3.523"], ["0", "1.0"], ["515", "3.512"]] as const) {
      const { ws, tunnel } = await live();
      tunnel.emit("data", Buffer.from(instruction("error", "Disconnected by other connection.", status)));
      expect(ws.send).toHaveBeenLastCalledWith(expect.stringMatching(new RegExp(`,${sent.replace(".", "\\.")};$`)));
      expect(mocks.audit).toHaveBeenLastCalledWith("u", "server.rdp.closed", expect.objectContaining({ reason: `guacd: ${status} Disconnected by other connection.` }), undefined, "t");
      stop?.();
    }
  });
});
