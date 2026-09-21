import { afterEach, describe, expect, it, vi } from "vitest";
import Guacamole from "guacamole-common-js";
import { createRdpTunnel, rdpTicketError, rdpWebSocketUrl } from "../rdp-tunnel";

class Socket {
  static OPEN = 1;
  static current: Socket;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(readonly url: string, readonly protocol: string) { Socket.current = this; }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("RDP browser tunnel", () => {
  it("keeps tickets out of URLs and sends them only in the first WS frame", () => {
    vi.stubGlobal("WebSocket", Socket);
    const url = rdpWebSocketUrl({ protocol: "https:", host: "example.test" });
    expect(url).toBe("wss://example.test/rdp");
    const tunnel = createRdpTunnel(Guacamole, url);
    const instruction = vi.fn(); tunnel.oninstruction = instruction;
    tunnel.connect("short-lived-ticket");
    const socket = Socket.current;
    expect(socket.url).not.toContain("ticket");
    expect(socket.protocol).toBe("guacamole");
    socket.onopen?.();
    expect(socket.send).toHaveBeenCalledExactlyOnceWith("short-lived-ticket");
    tunnel.sendMessage("key", 65, 1);
    expect(socket.send).toHaveBeenCalledTimes(1);
    socket.onmessage?.({ data: "0.,2.id;4.sync,1.1;" });
    expect(tunnel.state).toBe(Guacamole.Tunnel.State.OPEN);
    expect(instruction).toHaveBeenCalledWith("sync", ["1"]);
    tunnel.sendMessage("key", 65, 1);
    expect(socket.send).toHaveBeenLastCalledWith("3.key,2.65,1.1;");
    tunnel.disconnect();
    expect(socket.close).toHaveBeenCalled();
    expect(socket.onmessage).toBeNull();
    expect(tunnel.state).toBe(Guacamole.Tunnel.State.CLOSED);
  });
  it("times out a bridge that never completes its handshake", () => {
    vi.useFakeTimers(); vi.stubGlobal("WebSocket", Socket);
    const tunnel = createRdpTunnel(Guacamole, "ws://localhost/rdp");
    tunnel.onerror = vi.fn(); tunnel.connect("ticket");
    vi.advanceTimersByTime(34_999);
    expect(tunnel.onerror).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tunnel.onerror).toHaveBeenCalled();
    expect(tunnel.state).toBe(Guacamole.Tunnel.State.CLOSED);
  });
  it("keeps the handshake UUID and does not clobber it with ping echoes", () => {
    vi.stubGlobal("WebSocket", Socket);
    const tunnel = createRdpTunnel(Guacamole, "ws://localhost/rdp");
    const instruction = vi.fn(); tunnel.oninstruction = instruction;
    tunnel.connect("ticket");
    const socket = Socket.current;
    socket.onopen?.();
    socket.onmessage?.({ data: "0.,4.uuid;" });
    expect(tunnel.state).toBe(Guacamole.Tunnel.State.OPEN);
    expect(tunnel.uuid).toBe("uuid");
    socket.onmessage?.({ data: "0.,4.ping,13.1696000000000;" });
    expect(tunnel.state).toBe(Guacamole.Tunnel.State.OPEN);
    expect(tunnel.uuid).toBe("uuid");
    // Ping echoes still reach the Guacamole client: it reschedules its own
    // keep-alive on network activity.
    expect(instruction).toHaveBeenCalledWith("", ["ping", "1696000000000"]);
    socket.onmessage?.({ data: "4.sync,1.1;" });
    expect(instruction).toHaveBeenCalledWith("sync", ["1"]);
    tunnel.disconnect();
  });
  it("pings the bridge every 5s once the tunnel is open", () => {
    vi.useFakeTimers(); vi.stubGlobal("WebSocket", Socket);
    const tunnel = createRdpTunnel(Guacamole, "ws://localhost/rdp");
    tunnel.connect("ticket");
    const socket = Socket.current;
    socket.onopen?.();
    socket.onmessage?.({ data: "0.,4.uuid;" });
    vi.advanceTimersByTime(5_000);
    expect(socket.send).toHaveBeenCalledWith(expect.stringMatching(/^0\.,4\.ping,\d+\.\d+;$/));
    vi.advanceTimersByTime(5_000);
    expect(socket.send.mock.calls.filter(call => /^0\.,4\.ping,\d+\.\d+;$/.test(String(call[0])))).toHaveLength(2);
    tunnel.disconnect();
    vi.advanceTimersByTime(10_000);
    expect(socket.send.mock.calls.filter(call => /^0\.,4\.ping,\d+\.\d+;$/.test(String(call[0])))).toHaveLength(2);
  });
  it("fails a bridge that goes silent after the session opened", () => {
    vi.useFakeTimers(); vi.stubGlobal("WebSocket", Socket);
    const tunnel = createRdpTunnel(Guacamole, "ws://localhost/rdp");
    tunnel.onerror = vi.fn();
    tunnel.connect("ticket");
    const socket = Socket.current;
    socket.onopen?.();
    socket.onmessage?.({ data: "0.,4.uuid;" });
    expect(tunnel.state).toBe(Guacamole.Tunnel.State.OPEN);
    vi.advanceTimersByTime(29_999);
    expect(tunnel.onerror).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(tunnel.onerror).toHaveBeenCalled();
    expect(tunnel.state).toBe(Guacamole.Tunnel.State.CLOSED);
  });
  it("maps errors to safe translation keys without reflecting server messages", () => {
    expect(rdpTicketError(401)).toBe("rdp.error.session");
    expect(rdpTicketError(403)).toBe("rdp.error.denied");
    expect(rdpTicketError(429)).toBe("rdp.error.rate");
    expect(rdpTicketError(503)).toBe("rdp.error.connection");
  });
});
