import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";
import { closeSocket, CLOSE_HANDSHAKE_GRACE_MS } from "../close-socket";

const fakeSocket = () => ({ close: vi.fn(), terminate: vi.fn() });

describe("closeSocket", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("closes politely with the arguments given, then drops a socket that never answers", () => {
    const socket = fakeSocket();
    closeSocket(socket as unknown as WebSocket, 1013, "busy");
    expect(socket.close).toHaveBeenCalledWith(1013, "busy");
    expect(socket.terminate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(CLOSE_HANDSHAKE_GRACE_MS);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it("passes no arguments through when it is given none", () => {
    const socket = fakeSocket();
    closeSocket(socket as unknown as WebSocket);
    expect(socket.close).toHaveBeenCalledWith();
  });

  it("does not fail when the socket is already gone by the deadline", () => {
    const socket = fakeSocket();
    socket.terminate.mockImplementation(() => { throw new Error("gone"); });
    closeSocket(socket as unknown as WebSocket, 1000);
    expect(() => vi.advanceTimersByTime(CLOSE_HANDSHAKE_GRACE_MS)).not.toThrow();
  });
});
