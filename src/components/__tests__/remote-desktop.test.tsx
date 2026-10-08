import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { instruction, GuacParser } from "@/lib/rdp/protocol";
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
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
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

async function connectedDesktop() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "test-ticket", path: "/rdp" }), { status: 200 })));
  render(<RemoteDesktop serverId="test-server" />);
  fireEvent.click(screen.getByRole("button", { name: "rdp.connect" }));
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0]!;
  act(() => {
    socket.onopen?.();
    socket.onmessage?.({ data: instruction("", "uuid") + instruction("sync", "1") });
  });
  socket.send.mockClear();
  return { socket, input: screen.getByRole("textbox", { name: "rdp.input" }) };
}
function sentInstructions(socket: Socket) {
  const rows: string[][] = [];
  const parser = new GuacParser(row => rows.push(row));
  for (const [data] of socket.send.mock.calls) parser.feed(data);
  return rows;
}
it.each([
  { modifier: "Control", modifierCode: 17, key: "v", keyCode: 86, ctrlKey: true },
  { modifier: "Meta", modifierCode: 91, key: "v", keyCode: 86, metaKey: true },
  { modifier: "Shift", modifierCode: 16, key: "Insert", keyCode: 45, shiftKey: true },
])("allows native $modifier+$key and sends text before the remote paste key", async shortcut => {
  const { socket, input } = await connectedDesktop();
  const { modifier, modifierCode, key: pasteKey, keyCode, ...flags } = shortcut;
  fireEvent.keyDown(input, { ...flags, key: modifier, keyCode: modifierCode });
  const key = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...flags, key: pasteKey, keyCode });
  fireEvent(input, key);
  expect(key.defaultPrevented).toBe(false);
  expect(sentInstructions(socket).some(row => row[0] === "key" && row[1] === "118" && row[2] === "1")).toBe(false);
  const text = "中文🙂\nsecond line";
  fireEvent.paste(input, { clipboardData: { types: ["text/plain"], getData: () => text } });
  const rows = sentInstructions(socket);
  const end = rows.findIndex(row => row[0] === "end");
  expect(Buffer.concat(rows.filter(row => row[0] === "blob").map(row => Buffer.from(row[2]!, "base64"))).toString()).toBe(text);
  expect(rows.findIndex(row => row[0] === "key" && row[1] === "118" && row[2] === "1")).toBeGreaterThan(end);
  expect(rows.filter(row => row[0] === "key" && row[1] === "118" && row[2] === "1")).toHaveLength(1);
  expect(input).toHaveValue("");
});
it("pastes through the browser menu even when WebKit omits clipboard types", async () => {
  const { socket, input } = await connectedDesktop();
  fireEvent.paste(input, { clipboardData: { types: [], getData: () => "menu paste" } });
  expect(sentInstructions(socket).map(row => row[0])).toEqual(["clipboard", "blob", "end", "key", "key", "key", "key"]);
});
it("does not silently truncate oversized outgoing text or paste stale remote text", async () => {
  const { socket, input } = await connectedDesktop();
  fireEvent.paste(input, { clipboardData: { types: ["text/plain"], getData: () => "x".repeat(262145) } });
  expect(sentInstructions(socket)).toEqual([]);
  expect(screen.getByText("rdp.error.clipboardSize")).toBeVisible();
});
it("acknowledges each incoming blob and synchronizes multi-chunk and empty clipboards", async () => {
  const { socket } = await connectedDesktop();
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
  act(() => socket.onmessage?.({ data: instruction("clipboard", "7", "text/plain") + instruction("blob", "7", btoa("first")) }));
  expect(sentInstructions(socket)).toContainEqual(["ack", "7", "OK", "0"]);
  expect(writeText).not.toHaveBeenCalled();
  act(() => socket.onmessage?.({ data: instruction("blob", "7", btoa("second")) + instruction("end", "7") }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("firstsecond"));
  expect(sentInstructions(socket).filter(row => row[0] === "ack")).toHaveLength(2);
  act(() => socket.onmessage?.({ data: instruction("clipboard", "8", "text/plain") + instruction("end", "8") }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(""));
});
