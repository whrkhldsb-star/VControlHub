// @vitest-environment node
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instruction } from "@/lib/rdp/protocol";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getServer: vi.fn(), tunnel: vi.fn(), webSocketServer: vi.fn(), audit: vi.fn(async () => undefined) }));
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
vi.mock("@/lib/rdp/features", () => ({ rdpAudioEnabled: () => false, rdpClipboardEnabled: () => false, RDP_AUDIO_MIMETYPES: [] }));

import { initialDesktopSize, setupRdpWebSocket } from "@/lib/rdp/ws";

type FakeWs = EventEmitter & { readyState: number; bufferedAmount: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; ping: ReturnType<typeof vi.fn>; answersPings: boolean };

describe("RDP session slots", () => {
  let stop: (() => void) | undefined;
  let wss: EventEmitter & { clients: Set<unknown>; close: () => void };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.verify.mockResolvedValue({ userId: "u", roles: ["admin"], currentTeamId: "t", mustChangePassword: false });
    wss = Object.assign(new EventEmitter(), { clients: new Set<unknown>(), close: vi.fn() });
    mocks.webSocketServer.mockReturnValue(wss);
    stop = setupRdpWebSocket(new EventEmitter() as Server);
  });
  afterEach(() => { stop?.(); vi.useRealTimers(); });

  /** One browser connection to `serverId`, through the guacd handshake. */
  async function open(serverId: string, url = "/rdp", args = instruction("args")) {
    mocks.getServer.mockResolvedValue({ id: serverId, teamId: "t", host: "192.0.2.1", port: 3389, username: "test", rdpPassword: "sealed" });
    const tunnel = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), destroy: vi.fn(), pause: vi.fn(), resume: vi.fn(), writable: true, connecting: false, destroyed: false });
    mocks.tunnel.mockReturnValue(tunnel);
    const ws: FakeWs = Object.assign(new EventEmitter(), {
      readyState: 1, bufferedAmount: 0, send: vi.fn(), answersPings: true,
      close: vi.fn((code?: number) => { if (ws.readyState === 3) return; ws.readyState = 3; ws.emit("close", code ?? 1005); }),
      terminate: vi.fn(() => { if (ws.readyState === 3) return; ws.readyState = 3; ws.emit("close", 1006); }),
      ping: vi.fn(() => { if (ws.answersPings) ws.emit("pong"); }),
    });
    wss.clients.add(ws);
    wss.emit("connection", ws, { url, headers: { cookie: "session=authenticated", origin: "https://hub.test" } });
    await ws.listeners("message")[0]!(Buffer.from("single-use-ticket"), false);
    tunnel.emit("data", Buffer.from(args + instruction("ready", "tunnel")));
    return { ws, tunnel };
  }
  const errorStatus = (ws: FakeWs) => ws.send.mock.calls.map(([data]) => String(data)).find((data) => data.startsWith("5.error"));
  const handshakeSize = (tunnel: { write: ReturnType<typeof vi.fn> }) => tunnel.write.mock.calls.map(([data]) => String(data)).find((data) => data.includes("4.size,"));

  it("starts the desktop at the size the browser asked for, its width a multiple of 4 as guacd keeps it", async () => {
    const { tunnel } = await open("a", "/rdp?width=1603&height=903");
    expect(handshakeSize(tunnel)).toContain(instruction("size", "1600", "903", "96"));
  });

  it("asks guacd for the graphics path whose resizes cannot interrupt a paint", async () => {
    // guacd 1.6.0 with FreeRDP 2 aborted the session when a GFX resize landed
    // mid-paint; without GFX the colour depth must be asked for.
    const { tunnel } = await open("a", "/rdp?width=1600&height=900", instruction("args", "VERSION_1_5_0", "hostname", "disable-gfx", "color-depth", "resize-method"));
    const connect = tunnel.write.mock.calls.map(([data]) => String(data)).find((data) => data.includes("7.connect,"));
    expect(connect).toContain(instruction("connect", "VERSION_1_5_0", "192.0.2.1", "true", "24", "display-update"));
  });

  it("falls back to 1280 x 800 without a usable size", () => {
    expect(initialDesktopSize(undefined)).toEqual({ width: 1280, height: 800 });
    expect(initialDesktopSize("/rdp?width=99999&height=900")).toEqual({ width: 1280, height: 800 });
    expect(initialDesktopSize("/rdp?width=1e3&height=1.5")).toEqual({ width: 1280, height: 800 });
    expect(initialDesktopSize("/rdp?width=800&height=600")).toEqual({ width: 800, height: 600 });
    expect(initialDesktopSize("/rdp?width=1366&height=768")).toEqual({ width: 1364, height: 768 });
  });

  it("replaces the old session when the same user reconnects to the same server", async () => {
    // Two desktops fill the per-user cap; the browser's path to the first
    // died without a close, as behind Cloudflare.
    const first = await open("a");
    await open("b");
    const again = await open("a");
    // The reconnect is accepted, not refused for the cap.
    expect(errorStatus(again.ws)).toBeUndefined();
    expect(handshakeSize(again.tunnel)).toBeDefined();
    // The old one is told it was taken over (no retry) and leaves guacd at once.
    expect(errorStatus(first.ws)).toContain(instruction("error", "RDP session taken over by a new connection", "521"));
    expect(first.tunnel.end).toHaveBeenCalledWith(instruction("disconnect"));
    expect(mocks.audit).toHaveBeenCalledWith("u", "server.rdp.closed", expect.objectContaining({ serverId: "a", reason: "gateway: RDP session taken over by a new connection" }), undefined, "t");
  });

  it("says when the per-user cap refuses a desktop on another server", async () => {
    await open("a");
    await open("b");
    const third = await open("c");
    expect(errorStatus(third.ws)).toContain(instruction("error", "Too many RDP sessions for this user", "797"));
    expect(third.ws.close).toHaveBeenCalledWith(1008);
    expect(handshakeSize(third.tunnel)).toBeUndefined();
  });

  it("ends a session whose browser stopped answering pings, and frees its slot", async () => {
    const dead = await open("a");
    const alive = await open("b");
    dead.ws.answersPings = false;
    await vi.advanceTimersByTimeAsync(80_000);
    expect(dead.ws.terminate).toHaveBeenCalled();
    expect(dead.tunnel.end).toHaveBeenCalledWith(instruction("disconnect"));
    expect(alive.ws.terminate).not.toHaveBeenCalled();
    expect(alive.ws.close).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith("u", "server.rdp.closed", expect.objectContaining({ serverId: "a", reason: "gateway: browser stopped answering" }), undefined, "t");
    // The slot is free: a desktop on a third server is accepted.
    const third = await open("c");
    expect(errorStatus(third.ws)).toBeUndefined();
  });
});
