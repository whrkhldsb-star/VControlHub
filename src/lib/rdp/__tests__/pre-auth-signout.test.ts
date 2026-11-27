// @vitest-environment node
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instruction } from "@/lib/rdp/protocol";
import { guacdHandshake } from "@/test/helpers/guacd";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getServer: vi.fn(), tunnel: vi.fn(), webSocketServer: vi.fn() }));
vi.mock("ws", () => ({
  WebSocket: { OPEN: 1 },
  WebSocketServer: class { constructor() { return mocks.webSocketServer(); } },
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: async () => async () => {} }));
vi.mock("node:net", async (original) => {
  const net = await original<typeof import("node:net")>();
  return { ...net, createConnection: () => mocks.tunnel(), default: { ...net, createConnection: () => mocks.tunnel() } };
});
vi.mock("@/lib/auth/session", () => ({
  getSessionCookieName: () => "session",
  verifySessionToken: mocks.verify,
  // Only a cookie carrying this hub's signature has an expiry to read.
  sessionTokenExpiresAt: (token: string) => (token.startsWith("forged") ? null : Date.now() + 3_600_000),
}));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => true }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: async () => undefined }));
vi.mock("@/lib/crypto/service", () => ({ decrypt: () => "isolated-password" }));
vi.mock("@/lib/rdp/certificate", () => ({ rdpCertificateOptions: () => ({}) }));
vi.mock("@/lib/rdp/tickets", () => ({
  checkGuacd: async () => undefined, consumeRdpTicket: () => mocks.getServer(), getRdpServer: mocks.getServer,
  guacdPort: () => 4822, rdpEndpointHash: () => "endpoint", rdpOriginAllowed: () => true,
}));
vi.mock("@/lib/runtime-settings/service", () => ({ getRdpSessionRuntimeConfig: async () => ({ idleTimeoutMs: 0, maxSessionMs: 0 }) }));
vi.mock("@/lib/rdp/features", () => ({ rdpAudioEnabled: () => false, rdpClipboardEnabled: () => false, rdpImageMimetypes: async () => ["image/png"], RDP_AUDIO_MIMETYPES: [] }));

import { setupRdpWebSocket } from "@/lib/rdp/ws";
import { deliverSessionSignout, SESSION_SIGNOUT_MESSAGE_TYPE, sessionTokenHash } from "@/lib/ws/session-signout";

type FakeWs = EventEmitter & { readyState: number; bufferedAmount: number; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; terminate: ReturnType<typeof vi.fn>; ping: ReturnType<typeof vi.fn> };

describe("RDP unauthenticated sockets and sign-out", () => {
  let stop: (() => void) | undefined;
  let wss: EventEmitter & { clients: Set<unknown>; close: () => void };
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mocks.verify.mockResolvedValue({ userId: "u", roles: ["admin"], currentTeamId: "t", mustChangePassword: false });
    mocks.getServer.mockResolvedValue({ id: "s", teamId: "t", host: "192.0.2.1", port: 3389, username: "test", rdpPassword: "sealed" });
    wss = Object.assign(new EventEmitter(), { clients: new Set<unknown>(), close: vi.fn() });
    mocks.webSocketServer.mockReturnValue(wss);
    stop = setupRdpWebSocket(new EventEmitter() as Server);
  });
  afterEach(() => { stop?.(); vi.clearAllTimers(); vi.useRealTimers(); });

  function socket(cookie = "authenticated", headers: Record<string, string> = {}): FakeWs {
    const ws: FakeWs = Object.assign(new EventEmitter(), {
      readyState: 1, bufferedAmount: 0, send: vi.fn(), ping: vi.fn(() => ws.emit("pong")),
      close: vi.fn((code?: number) => { if (ws.readyState === 3) return; ws.readyState = 3; ws.emit("close", code ?? 1005); }),
      terminate: vi.fn(() => { if (ws.readyState === 3) return; ws.readyState = 3; ws.emit("close", 1006); }),
    });
    wss.clients.add(ws);
    wss.emit("connection", ws, { url: "/rdp", headers: { cookie: `session=${cookie}`, origin: "https://hub.test", ...headers } });
    return ws;
  }

  async function desktop(cookie = "authenticated") {
    const tunnel = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), destroy: vi.fn(), pause: vi.fn(), resume: vi.fn(), writable: true, connecting: false, destroyed: false });
    mocks.tunnel.mockReturnValue(tunnel);
    const ws = socket(cookie);
    await ws.listeners("message")[0]!(Buffer.from("single-use-ticket"), false);
    await guacdHandshake(tunnel);
    expect(ws.readyState).toBe(1);
    return { ws, tunnel };
  }

  it("refuses an unsigned session cookie before it takes an unauthenticated place", async () => {
    // 50 forged cookies, more than the 40 places: none is held, so a real browser still gets in.
    const forged = Array.from({ length: 50 }, (_, i) => socket(`forged-${i}`));
    expect(forged.every((ws) => ws.terminate.mock.calls.length === 1)).toBe(true);
    const { ws } = await desktop();
    expect(ws.close).not.toHaveBeenCalled();
    expect(mocks.verify).toHaveBeenCalled();
  });

  it("counts unauthenticated places per IPv6 /64, as HTTP rate limits do", () => {
    const sameNetwork = Array.from({ length: 12 }, (_, i) => socket("authenticated", { "x-forwarded-for": `2001:db8:1:2::${(i + 1).toString(16)}` }));
    expect(sameNetwork.every((ws) => ws.terminate.mock.calls.length === 0)).toBe(true);
    expect(socket("authenticated", { "x-forwarded-for": "2001:db8:1:2:ffff::7" }).terminate).toHaveBeenCalled();
    expect(socket("authenticated", { "x-forwarded-for": "2001:db8:77::1" }).terminate).not.toHaveBeenCalled();
  });

  it("drops a socket that presents no ticket within 3 seconds, by its own timer", async () => {
    const idle = socket();
    await vi.advanceTimersByTimeAsync(2_900);
    expect(idle.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    expect(idle.close).toHaveBeenCalledWith(1008);
    expect(idle.send).toHaveBeenCalledWith(instruction("error", "RDP authentication timed out", "512"));
  });

  it("gives a ticket already being authorized the rest of the authentication window", async () => {
    mocks.verify.mockImplementation(() => new Promise(() => undefined));
    const slow = socket();
    void slow.listeners("message")[0]!(Buffer.from("single-use-ticket"), false);
    await vi.advanceTimersByTimeAsync(3_500);
    expect(slow.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(6_600);
    expect(slow.close).toHaveBeenCalledWith(1008);
  });

  it("does not drop a desktop that authenticated in time", async () => {
    const { ws } = await desktop();
    await vi.advanceTimersByTimeAsync(12_000);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("ends the desktops of a signed-out cookie at once, as ended sessions the browser does not retry", async () => {
    const signedOut = await desktop("authenticated");
    mocks.getServer.mockResolvedValue({ id: "s2", teamId: "t", host: "192.0.2.2", port: 3389, username: "test", rdpPassword: "sealed" });
    const otherDevice = await desktop("other-device");
    const pending = socket("authenticated");

    expect(deliverSessionSignout("u", { type: SESSION_SIGNOUT_MESSAGE_TYPE, tokenHash: sessionTokenHash("authenticated") })).toBe(true);
    expect(signedOut.ws.send).toHaveBeenCalledWith(instruction("error", "RDP session signed out", "0"));
    expect(signedOut.ws.close).toHaveBeenCalledWith(1008);
    expect(pending.close).toHaveBeenCalledWith(1008);
    expect(otherDevice.ws.close).not.toHaveBeenCalled();
  });

  it("stops listening for sign-outs once the bridge is closed", async () => {
    const { ws } = await desktop();
    stop?.();
    stop = undefined;
    ws.send.mockClear();
    deliverSessionSignout("u", { type: SESSION_SIGNOUT_MESSAGE_TYPE, tokenHash: sessionTokenHash("authenticated") });
    expect(ws.send).not.toHaveBeenCalled();
  });
});
