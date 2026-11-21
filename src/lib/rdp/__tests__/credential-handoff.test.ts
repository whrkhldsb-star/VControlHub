// @vitest-environment node
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instruction } from "@/lib/rdp/protocol";

const locking = vi.hoisted(() => ({ acquire: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: locking.acquire }));
const mocks = vi.hoisted(() => ({ verify: vi.fn(), getServer: vi.fn(), tunnel: vi.fn(), webSocketServer: vi.fn(), clipboard: vi.fn(), audit: vi.fn(async () => undefined), images: vi.fn(async () => ["image/png", "image/jpeg"]) }));
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
vi.mock("@/lib/rdp/features", () => ({ rdpAudioEnabled: () => false, rdpClipboardEnabled: mocks.clipboard, rdpImageMimetypes: mocks.images, RDP_AUDIO_MIMETYPES: [] }));

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

  async function connect() {
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
    tunnel.emit("data", Buffer.from(instruction("args", "username", "password")));
    expect(ws.close).not.toHaveBeenCalled();
    return { ws, tunnel };
  }

  it("revalidates after transfer completes and before sending credentials to guacd", async () => {
    const gate = Promise.withResolvers<typeof locking.release>();
    locking.acquire.mockReturnValueOnce(gate.promise);
    const { ws, tunnel } = await connect();
    expect(locking.acquire).toHaveBeenCalledWith("server-delete", "s");
    expect(tunnel.write).not.toHaveBeenCalled();
    mocks.getServer.mockRejectedValueOnce(new Error("transferred"));
    gate.resolve(locking.release);
    await vi.advanceTimersByTimeAsync(0);
    expect(ws.close).toHaveBeenCalledWith(1008);
    expect(tunnel.write).not.toHaveBeenCalled();
    expect(locking.release).toHaveBeenCalledTimes(1);
  });

  it("submits one login under the handoff lock and accepts guacd's ready reply", async () => {
    const gate = Promise.withResolvers<typeof locking.release>();
    locking.acquire.mockReturnValueOnce(gate.promise);
    const { ws, tunnel } = await connect();
    expect(tunnel.write).not.toHaveBeenCalled();
    gate.resolve(locking.release);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.verify).toHaveBeenCalledTimes(2);
    expect(mocks.getServer).toHaveBeenCalledTimes(2);
    expect(tunnel.write).toHaveBeenCalledTimes(1);
    expect(tunnel.write).toHaveBeenCalledWith(expect.stringContaining(instruction("connect", "test", "isolated-password")));
    expect(tunnel.write.mock.invocationCallOrder[0]).toBeLessThan(locking.release.mock.invocationCallOrder[0]!);
    tunnel.emit("data", Buffer.from(instruction("ready", "tunnel")));
    expect(ws.send).toHaveBeenCalledWith(instruction("", "tunnel"));
  });
});
