import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { RemoteDesktop } from "../remote-desktop";

vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
// Keep csrfFetch, Guacamole and the tunnel real: only browser IO is stubbed.
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(readonly url: string, readonly protocol: string) { Socket.instances.push(this); }
}
beforeEach(() => {
  Socket.instances = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(new Proxy({}, {
    get: (_target, key) => key === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : vi.fn(),
  }) as CanvasRenderingContext2D);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("opens WS after ticket HTTP 200 using the real csrfFetch and Guacamole APIs", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "test-ticket", path: "/rdp" }), { status: 200 })));
  render(<RemoteDesktop serverId="test-server" />);
  fireEvent.click(screen.getByRole("button", { name: "rdp.connect" }));
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  expect(screen.getByRole("application")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  const socket = Socket.instances[0]!;
  expect(socket.url).not.toContain("test-ticket");
  socket.onopen?.();
  expect(socket.send).toHaveBeenCalledWith("test-ticket");
  fireEvent.click(screen.getByRole("button", { name: "rdp.disconnect" }));
  expect(socket.close).toHaveBeenCalled();
  expect(screen.getByRole("status")).toHaveTextContent("rdp.status.disconnected");
});
it.each<[number, string]>([[401, "session"], [403, "denied"], [429, "rate"]])("maps ticket HTTP %i without opening WS", async (status: number, key: string) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
  render(<RemoteDesktop serverId="test-server" />);
  fireEvent.click(screen.getByRole("button", { name: "rdp.connect" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(`rdp.error.${key}`);
  expect(Socket.instances).toHaveLength(0);
});
it("auto-reconnects with backoff after a dropped live session", async () => {
  vi.useFakeTimers();
  // A fresh Response per call: the body can only be consumed once.
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ token: "test-ticket", path: "/rdp" }), { status: 200 }))));
  render(<RemoteDesktop serverId="test-server" />);
  fireEvent.click(screen.getByRole("button", { name: "rdp.connect" }));
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const socket = Socket.instances[0]!;
  act(() => { socket.onopen?.(); });
  expect(socket.send).toHaveBeenCalledWith("test-ticket");
  // Bridge handshake: the UUID means the RDP session itself is live.
  act(() => { socket.onmessage?.({ data: "0.,4.uuid;" }); });
  act(() => { socket.onclose?.(); });
  expect(screen.getByRole("status")).toHaveTextContent("rdp.status.reconnecting");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  expect(Socket.instances).toHaveLength(2);
  expect(Socket.instances[1]!.url).not.toContain("test-ticket");
});
