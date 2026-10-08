// @vitest-environment node
import { EventEmitter } from "node:events";
import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { instruction } from "@/lib/rdp/protocol";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), getServer: vi.fn(), tunnel: vi.fn(), webSocketServer: vi.fn(), clipboard: vi.fn() }));
vi.mock("ws", () => ({
  WebSocket: { OPEN: 1 },
  WebSocketServer: class { constructor() { return mocks.webSocketServer(); } },
}));
vi.mock("node:net", () => ({ createConnection: () => mocks.tunnel() }));
vi.mock("@/lib/auth/session", () => ({ getSessionCookieName: () => "session", verifySessionToken: mocks.verify }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => true }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: async () => undefined }));
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

  async function connect() {
    const tunnel = Object.assign(new EventEmitter(), { write: vi.fn(), destroy: vi.fn(), pause: vi.fn(), resume: vi.fn() });
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
    tunnel.emit("data", Buffer.from(instruction("args") + instruction("ready", "tunnel")));
    expect(ws.close).not.toHaveBeenCalled();
    return { ws, tunnel };
  }

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
