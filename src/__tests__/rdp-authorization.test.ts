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
      readyState: 1, bufferedAmount: 0, send: vi.fn(),
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
    const ws = Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn(() => { ws.readyState = 3; ws.emit("close", 1000); }), terminate: () => ws.close() });
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
