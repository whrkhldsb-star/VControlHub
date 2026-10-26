// @vitest-environment node
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instruction } from "@/lib/rdp/protocol";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getServer: vi.fn(), tunnel: vi.fn(), webSocketServer: vi.fn(), audit: vi.fn(async () => undefined), images: vi.fn(async () => ["image/png", "image/jpeg"]) }));
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
vi.mock("@/lib/rdp/features", () => ({ rdpAudioEnabled: () => false, rdpClipboardEnabled: () => false, rdpImageMimetypes: mocks.images, RDP_AUDIO_MIMETYPES: [] }));

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

  it("tells guacd the browser takes WebP only when the setting says so", async () => {
    // guacd then sends often-changing regions as WebP instead of JPEG.
    const plain = await open("a");
    expect(plain.tunnel.write.mock.calls.map(([data]) => String(data)).join("")).toContain(instruction("image", "image/png", "image/jpeg") + instruction("connect"));
    mocks.images.mockResolvedValueOnce(["image/png", "image/jpeg", "image/webp"]);
    const webp = await open("b");
    expect(webp.tunnel.write.mock.calls.map(([data]) => String(data)).join("")).toContain(instruction("image", "image/png", "image/jpeg", "image/webp"));
  });

  it("falls back to 1280 x 800 without a usable size", () => {
    expect(initialDesktopSize(undefined)).toEqual({ width: 1280, height: 800 });
    expect(initialDesktopSize("/rdp?width=99999&height=900")).toEqual({ width: 1280, height: 800 });
    expect(initialDesktopSize("/rdp?width=1e3&height=1.5")).toEqual({ width: 1280, height: 800 });
    expect(initialDesktopSize("/rdp?width=800&height=600")).toEqual({ width: 800, height: 600 });
    expect(initialDesktopSize("/rdp?width=1366&height=768")).toEqual({ width: 1364, height: 768 });
  });

  it("replaces the old session when the same user reconnects to the same server", async () => {
    // Three desktops fill the per-user cap; the browser's path to the first
    // died without a close, as behind Cloudflare.
    const first = await open("a");
    await open("b");
    await open("c");
    const again = await open("a");
    // The reconnect is accepted, not refused for the cap.
    expect(errorStatus(again.ws)).toBeUndefined();
    expect(handshakeSize(again.tunnel)).toBeDefined();
    // The old one is told it was taken over (no retry) and leaves guacd at once.
    expect(errorStatus(first.ws)).toContain(instruction("error", "RDP session taken over by a new connection", "521"));
    expect(first.tunnel.end).toHaveBeenCalledWith(instruction("disconnect"));
    expect(mocks.audit).toHaveBeenCalledWith("u", "server.rdp.closed", expect.objectContaining({ serverId: "a", reason: "gateway: RDP session taken over by a new connection" }), undefined, "t");
  });

  it("allows three desktops per user and says when the cap refuses a fourth", async () => {
    await open("a");
    await open("b");
    const third = await open("c");
    expect(errorStatus(third.ws)).toBeUndefined();
    const fourth = await open("d");
    expect(errorStatus(fourth.ws)).toContain(instruction("error", "Too many RDP sessions for this user", "797"));
    expect(fourth.ws.close).toHaveBeenCalledWith(1008);
    expect(handshakeSize(fourth.tunnel)).toBeUndefined();
  });

  it("keeps a desktop whose browser stops answering for a while, as Chrome's frozen background tabs do", async () => {
    // Ending it after 60 s without a pong cut such a desktop every 6-8
    // minutes in production; it reconnected when its tab was shown again.
    const frozen = await open("a");
    frozen.ws.answersPings = false;
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(frozen.ws.terminate).not.toHaveBeenCalled();
    expect(frozen.ws.close).not.toHaveBeenCalled();
    expect(frozen.tunnel.end).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalledWith("u", "server.rdp.closed", expect.anything(), undefined, "t");
  });

  it("gives the slot of the desktop silent longest to a new one once the cap is reached", async () => {
    const first = await open("a");
    const answering = await open("b");
    const later = await open("c");
    first.ws.answersPings = false;
    await vi.advanceTimersByTimeAsync(30_000);
    later.ws.answersPings = false;
    await vi.advanceTimersByTimeAsync(70_000);
    const fourth = await open("d");
    expect(errorStatus(fourth.ws)).toBeUndefined();
    expect(handshakeSize(fourth.tunnel)).toBeDefined();
    // Only the one silent longest goes, told why, and leaves guacd at once.
    expect(errorStatus(first.ws)).toContain(instruction("error", "RDP session given up for a new desktop: its browser had stopped answering", "521"));
    expect(first.tunnel.end).toHaveBeenCalledWith(instruction("disconnect"));
    expect(later.ws.close).not.toHaveBeenCalled();
    expect(answering.ws.close).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith("u", "server.rdp.closed", expect.objectContaining({ serverId: "a", reason: "gateway: RDP session given up for a new desktop: its browser had stopped answering" }), undefined, "t");
  });

  it("does not give up a desktop whose browser still sends, though its pongs are late behind a full downlink", async () => {
    const busy = await open("a");
    await open("b");
    await open("c");
    busy.ws.answersPings = false;
    for (let i = 0; i < 10; i += 1) {
      await vi.advanceTimersByTimeAsync(10_000);
      await busy.ws.listeners("message")[0]!(Buffer.from(instruction("nop")), false);
    }
    const fourth = await open("d");
    expect(errorStatus(fourth.ws)).toContain(instruction("error", "Too many RDP sessions for this user", "797"));
    expect(busy.ws.close).not.toHaveBeenCalled();
  });
});
