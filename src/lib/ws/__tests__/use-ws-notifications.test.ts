import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class FakeWebSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  send(payload: string) {
    this.sent.push(payload);
  }
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
  fakeOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  fakeMessage(data: string) {
    this.onmessage?.({ data });
  }
  fakeClose() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

function installFakeWebSocket() {
  (globalThis as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
}

beforeEach(() => {
  vi.useFakeTimers();
  installFakeWebSocket();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "vcontrolhub_session=cookie-token-abc",
  });
});

afterEach(() => {
  vi.useRealTimers();
  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: () => "",
  });
});

import { useWsNotifications } from "@/lib/ws/use-ws-notifications";

describe("useWsNotifications", () => {
  it("starts with default values", () => {
    const { result } = renderHook(() => useWsNotifications());
    expect(result.current.connected).toBe(false);
    expect(result.current.lastNotification).toBeNull();
    expect(result.current.unreadCount).toBe(0);
    expect(result.current.lastDownloadProgress).toBeNull();
    expect(result.current.lastServerAlert).toBeNull();
  });

  it("opens a ws:// connection with the session token in the query string", () => {
    renderHook(() => useWsNotifications());
    const ws = FakeWebSocket.instances.at(-1)!;
    expect(ws.url).toMatch(/ws:\/\/[^/]+\/ws\?token=cookie-token-abc/);
  });

  it("flips connected to true on ws open and false on close", () => {
    const { result } = renderHook(() => useWsNotifications());
    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => ws.fakeOpen());
    expect(result.current.connected).toBe(true);
    act(() => ws.fakeClose());
    expect(result.current.connected).toBe(false);
  });

  it("parses notification / unread_count / download_progress / server_alert messages", () => {
    const { result } = renderHook(() => useWsNotifications());
    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => ws.fakeOpen());

    act(() =>
      ws.fakeMessage(
        JSON.stringify({
          type: "notification",
          data: {
            id: "n1",
            title: "t",
            message: "m",
            createdAt: "2025-01-15T03:30:45Z",
          },
        }),
      ),
    );
    expect(result.current.lastNotification?.id).toBe("n1");

    act(() => ws.fakeMessage(JSON.stringify({ type: "unread_count", count: 7 })));
    expect(result.current.unreadCount).toBe(7);

    act(() =>
      ws.fakeMessage(
        JSON.stringify({
          type: "download_progress",
          data: { taskId: "task-1", progress: 50, status: "running" },
        }),
      ),
    );
    expect(result.current.lastDownloadProgress?.taskId).toBe("task-1");

    act(() =>
      ws.fakeMessage(
        JSON.stringify({
          type: "server_alert",
          data: { serverId: "s-1", serverName: "S1", message: "down" },
        }),
      ),
    );
    expect(result.current.lastServerAlert?.serverId).toBe("s-1");
  });

  it("ignores non-JSON messages without throwing", () => {
    const { result } = renderHook(() => useWsNotifications());
    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => ws.fakeOpen());
    expect(() => act(() => ws.fakeMessage("not json"))).not.toThrow();
    expect(result.current.lastNotification).toBeNull();
  });

  it("reconnects after onclose via a 3s timer", () => {
    renderHook(() => useWsNotifications());
    const initialCount = FakeWebSocket.instances.length;
    const ws = FakeWebSocket.instances.at(-1)!;
    act(() => ws.fakeOpen());
    act(() => ws.fakeClose());
    act(() => vi.advanceTimersByTime(3000));
    expect(FakeWebSocket.instances.length).toBe(initialCount + 1);
  });
});
