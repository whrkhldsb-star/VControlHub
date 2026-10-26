import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { instruction, GuacParser } from "@/lib/rdp/protocol";
import { RemoteDesktopPanel, type RemoteDesktopPanelHandle } from "../remote-desktop-panel";

vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
/** A workbench tab: it connects as soon as it is shown. */
function renderPanel(handle = createRef<RemoteDesktopPanelHandle>()) {
  render(<RemoteDesktopPanel ref={handle} serverId="test-server" serverName="win" host="192.0.2.1" visible onClose={vi.fn()} />);
  return handle;
}
const overlay = () => screen.getByTestId("rdp-overlay");
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
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });
it("opens WS after ticket HTTP 200 using the real csrfFetch and Guacamole APIs", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "test-ticket", path: "/rdp" }), { status: 200 })));
  const handle = renderPanel();
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  expect(screen.getByRole("application")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  const socket = Socket.instances[0]!;
  expect(socket.url).not.toContain("test-ticket");
  socket.onopen?.();
  expect(socket.send).toHaveBeenCalledWith("test-ticket");
  // Closing the tab ends the session.
  act(() => handle.current!.endSession());
  expect(socket.close).toHaveBeenCalled();
  expect(overlay()).toHaveTextContent("rdp.status.disconnected");
});
it.each<[number, string]>([[401, "session"], [403, "denied"], [429, "rate"]])("maps ticket HTTP %i without opening WS", async (status: number, key: string) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status })));
  renderPanel();
  await waitFor(() => expect(overlay()).toHaveTextContent(`rdp.error.${key}`));
  expect(overlay()).toHaveAttribute("role", "alert");
  expect(Socket.instances).toHaveLength(0);
});
it("auto-reconnects with backoff after a dropped live session", async () => {
  vi.useFakeTimers();
  // A fresh Response per call: the body can only be consumed once.
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ token: "test-ticket", path: "/rdp" }), { status: 200 }))));
  renderPanel();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const socket = Socket.instances[0]!;
  act(() => { socket.onopen?.(); });
  expect(socket.send).toHaveBeenCalledWith("test-ticket");
  // Bridge handshake: the UUID means the RDP session itself is live.
  act(() => { socket.onmessage?.({ data: "0.,4.uuid;" }); });
  act(() => { socket.onclose?.(); });
  expect(overlay()).toHaveTextContent("rdp.status.reconnecting");
  expect(overlay()).toHaveAttribute("role", "status");
  await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
  expect(Socket.instances).toHaveLength(2);
  expect(Socket.instances[1]!.url).not.toContain("test-ticket");
});

it.each([[769, "rdp.error.credentials"], [771, "rdp.error.accountRefused"]])("stops and explains when Windows refuses the account (status %i)", async (status, message) => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ token: "test-ticket", path: "/rdp" }), { status: 200 }))));
  renderPanel();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const socket = Socket.instances[0]!;
  act(() => { socket.onopen?.(); });
  // The session is "ready" first; then Windows rejects the login.
  act(() => { socket.onmessage?.({ data: instruction("", "uuid") + instruction("sync", "1") }); });
  act(() => { socket.onmessage?.({ data: instruction("error", "Windows refused the login", String(status)) }); });
  act(() => { socket.onclose?.(); });
  expect(overlay()).toHaveTextContent(message);
  expect(overlay()).toHaveAttribute("role", "alert");
  // No retry: each attempt counts towards Windows' account lockout.
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(Socket.instances).toHaveLength(1);
});

it.each([[0x0209, "rdp.error.sessionConflict"], [0x020b, "rdp.error.sessionEnded"], [0, "rdp.error.sessionEnded"]])("stops and explains when Windows ends the session itself (status %i)", async (status, message) => {
  // Taken over by another connection, ended by an administrator, or signed
  // out inside Windows: reconnecting took the session back from whoever had
  // it (who took it back again), or signed the account back in.
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ token: "test-ticket", path: "/rdp" }), { status: 200 }))));
  renderPanel();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const socket = Socket.instances[0]!;
  act(() => { socket.onopen?.(); });
  act(() => { socket.onmessage?.({ data: instruction("", "uuid") + instruction("sync", "1") }); });
  act(() => { socket.onmessage?.({ data: instruction("error", "Windows ended the session", String(status)) }); });
  act(() => { socket.onclose?.(); });
  expect(overlay()).toHaveTextContent(message);
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(Socket.instances).toHaveLength(1);
});

async function connectedDesktop() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "test-ticket", path: "/rdp" }), { status: 200 })));
  renderPanel();
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
it("keeps the pointer on the desktop at its edge, where the browser reports -1", async () => {
  // Guacamole measures from the rounded offsetLeft while the pointer is at a
  // fractional clientX: on a desktop centred on a half pixel, entering it from
  // the left or top gave -1, and the gateway ended the session over it.
  const { socket } = await connectedDesktop();
  act(() => { socket.onmessage?.({ data: instruction("size", "0", "1024", "768") + instruction("sync", "2") }); });
  // The display applies the size on the next animation frame.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  socket.send.mockClear();
  const desktop = screen.getByRole("application").firstElementChild!;
  fireEvent.mouseMove(desktop, { clientX: -1, clientY: -2 });
  fireEvent.mouseMove(desktop, { clientX: 5000, clientY: 300 });
  const moves = sentInstructions(socket).filter(row => row[0] === "mouse");
  expect(moves).toEqual([["mouse", "0", "0", "0"], ["mouse", "1023", "300", "0"]]);
});
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

it("offers the on-screen keyboard and the pointer mode only on touch screens", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)", media: query, addEventListener() {}, removeEventListener() {} }));
  const { input } = await connectedDesktop();
  const pointer = screen.getByTestId("rdp-pointer-mode");
  expect(pointer).toHaveAccessibleName("rdp.pointer.touchpad");
  expect(screen.getByTestId("rdp-touch-hint")).toHaveTextContent("rdp.pointer.touchpadHint");
  // A tap must not open the keyboard; the keyboard chip does.
  expect(input).not.toHaveFocus();
  fireEvent.click(screen.getByTestId("rdp-keyboard"));
  expect(input).toHaveFocus();
  fireEvent.click(pointer);
  expect(pointer).toHaveAccessibleName("rdp.pointer.touch");
  expect(screen.getByTestId("rdp-touch-hint")).toHaveTextContent("rdp.pointer.touchHint");
});
it("keeps the desktop chrome free of touch controls on a mouse device", async () => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
  await connectedDesktop();
  expect(screen.queryByTestId("rdp-keyboard")).not.toBeInTheDocument();
  expect(screen.queryByTestId("rdp-pointer-mode")).not.toBeInTheDocument();
});

const flush = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
const sentKeys = (socket: Socket) => sentInstructions(socket).filter(row => row[0] === "key").map(row => row.slice(1));
it("keeps the focus on the non-editable desktop for the remote input method, and pastes through the text field", async () => {
  // A focused text field let the local input method compose as well as the
  // remote one. Firefox and Safari fire no paste event on a non-editable
  // element, so Ctrl+V moves the focus to the field and back.
  const { socket, input } = await connectedDesktop();
  const desktop = screen.getByRole("application");
  expect(desktop).toHaveFocus();
  expect(screen.getByTestId("rdp-input-method")).toHaveAccessibleName("rdp.inputMethod.remote");
  fireEvent.keyDown(desktop, { key: "Control", keyCode: 17, ctrlKey: true });
  fireEvent.keyDown(desktop, { key: "v", keyCode: 86, ctrlKey: true });
  expect(input).toHaveFocus();
  fireEvent.paste(input, { clipboardData: { types: ["text/plain"], getData: () => "pasted" } });
  await flush();
  expect(desktop).toHaveFocus();
  expect(sentInstructions(socket).some(row => row[0] === "clipboard")).toBe(true);
});
it("types text the local input method composed whole, before and after a direct commit", async () => {
  window.localStorage.setItem("vch.rdp.inputMethod", "local");
  const { socket, input: field } = await connectedDesktop();
  const input = field as HTMLTextAreaElement;
  expect(input).toHaveFocus();
  expect(screen.getByTestId("rdp-input-method")).toHaveAccessibleName("rdp.inputMethod.local");
  fireEvent.compositionStart(input);
  input.value = "ni";
  fireEvent(input, new InputEvent("input", { bubbles: true, data: "ni", inputType: "insertCompositionText", isComposing: true }));
  await flush();
  // Clearing the field mid-composition cancelled it, and the letters typed
  // next went to the remote input method.
  expect(input).toHaveValue("ni");
  input.value = "你";
  fireEvent(input, new InputEvent("input", { bubbles: true, data: "你", inputType: "insertCompositionText", isComposing: true }));
  fireEvent.compositionEnd(input, { data: "你" });
  // Committed directly, as an input method does with punctuation.
  input.value = "你，";
  fireEvent(input, new InputEvent("input", { bubbles: true, data: "，", inputType: "insertText" }));
  fireEvent.compositionStart(input);
  fireEvent.compositionEnd(input, { data: "好" });
  const typed = sentKeys(socket).filter(([, pressed]) => pressed === "1").map(([keysym]) => String.fromCodePoint(Number(keysym) & 0xffffff));
  expect(typed).toEqual(["你", "，", "好"]);
  await flush();
  expect(input).toHaveValue("");
});
it("keeps a lone Shift tap, the local input method's own Chinese/English switch, from Windows", async () => {
  window.localStorage.setItem("vch.rdp.inputMethod", "local");
  const { socket, input } = await connectedDesktop();
  fireEvent.keyDown(input, { key: "Shift", keyCode: 16, shiftKey: true });
  fireEvent.keyUp(input, { key: "Shift", keyCode: 16 });
  expect(sentKeys(socket)).toEqual([]);
  // Shift still works with another key.
  fireEvent.keyDown(input, { key: "Shift", keyCode: 16, shiftKey: true });
  fireEvent.keyDown(input, { key: "A", keyCode: 65, shiftKey: true });
  fireEvent.keyUp(input, { key: "A", keyCode: 65, shiftKey: true });
  fireEvent.keyUp(input, { key: "Shift", keyCode: 16 });
  expect(sentKeys(socket)).toEqual([["65505", "1"], ["65", "1"], ["65", "0"], ["65505", "0"]]);
});
it("switches the input method from the toolbar and remembers the choice", async () => {
  const { input } = await connectedDesktop();
  const desktop = screen.getByRole("application");
  desktop.focus();
  fireEvent.click(screen.getByTestId("rdp-input-method"));
  expect(window.localStorage.getItem("vch.rdp.inputMethod")).toBe("local");
  expect(screen.getByTestId("rdp-input-method")).toHaveAccessibleName("rdp.inputMethod.local");
  expect(screen.getByTestId("rdp-input-method")).toHaveAttribute("title", "rdp.inputMethod.localHint");
  input.focus();
  fireEvent.click(screen.getByTestId("rdp-input-method"));
  expect(window.localStorage.getItem("vch.rdp.inputMethod")).toBe("remote");
});

function areaOf(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(height);
}
const ticketResponse = () => Promise.resolve(new Response(JSON.stringify({ token: "test-ticket", path: "/rdp" }), { status: 200 }));

it("starts the desktop at the panel's size, and asks again once Windows' display channel is up", async () => {
  // guacd replaced a size asked for before the display channel was up with
  // the current size: the desktop stayed 1280 x 800 in a larger panel, with
  // black bands right and below.
  vi.useFakeTimers();
  areaOf(1601, 903);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(ticketResponse));
  renderPanel();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const socket = Socket.instances[0]!;
  // guacd rounds the starting width down to a multiple of 4; asking for that
  // width keeps the later requests from resizing it by a pixel or two.
  expect(socket.url).toMatch(/\/rdp\?width=1600&height=903$/);
  act(() => {
    socket.onopen?.();
    socket.onmessage?.({ data: instruction("", "uuid") + instruction("sync", "1") });
  });
  // The ticket frame is not a Guacamole instruction.
  socket.send.mockClear();
  const sizes = () => sentInstructions(socket).filter(([op]) => op === "size");
  await act(async () => { await vi.advanceTimersByTimeAsync(400); });
  expect(sizes()).toEqual([["size", "1600", "903"]]);
  await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
  expect(sizes()).toHaveLength(3);
  expect(sizes().every(([, w, h]) => w === "1600" && h === "903")).toBe(true);
});

it("starts a desktop that connects behind another tab at the last size a panel measured", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(ticketResponse));
  areaOf(1500, 800);
  renderPanel();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(Socket.instances[0]!.url).toMatch(/\?width=1500&height=800$/);
  // A hidden tab measures 0 x 0.
  areaOf(0, 0);
  render(<RemoteDesktopPanel serverId="other-server" serverName="win2" host="192.0.2.2" visible={false} onClose={vi.fn()} />);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  expect(Socket.instances[1]!.url).toMatch(/\?width=1500&height=800$/);
});

it("stops and explains when the per-user session cap refuses the desktop", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(ticketResponse));
  renderPanel();
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const socket = Socket.instances[0]!;
  act(() => { socket.onopen?.(); });
  act(() => { socket.onmessage?.({ data: instruction("error", "Too many RDP sessions for this user", "797") }); });
  act(() => { socket.onclose?.(); });
  expect(overlay()).toHaveTextContent("rdp.error.tooMany");
  await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
  expect(Socket.instances).toHaveLength(1);
});

/** The picture element Guacamole sizes to the desktop times its scale. */
const picture = () => screen.getByRole("application").firstElementChild as HTMLElement;
async function openWithDesktop(width: number, height: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const socket = Socket.instances.at(-1)!;
  act(() => {
    socket.onopen?.();
    socket.onmessage?.({ data: instruction("", "uuid") + instruction("size", "0", String(width), String(height)) + instruction("sync", "1") });
  });
  return socket;
}

it("fills the panel with a desktop smaller than it, then shows the resized desktop pixel for pixel", async () => {
  // Capped at 1, a desktop smaller than the panel (on entering full screen,
  // until Windows took the new size) stayed in the top-left corner.
  vi.useFakeTimers();
  areaOf(1601, 903);
  vi.stubGlobal("fetch", vi.fn().mockImplementation(ticketResponse));
  renderPanel();
  const socket = await openWithDesktop(800, 450);
  expect(parseFloat(picture().style.width)).toBeCloseTo(1601, 3);
  // Windows took the panel's size (its width a multiple of 4): no blur for a pixel.
  act(() => { socket.onmessage?.({ data: instruction("size", "0", "1600", "903") + instruction("sync", "2") }); });
  // Later frames are drawn on the display's own timer.
  await act(async () => { await vi.advanceTimersByTimeAsync(100); });
  expect(picture().style.width).toBe("1600px");
  expect(picture().style.height).toBe("903px");
});

it("keeps a chosen fixed resolution, scaled into the panel, and remembers it per server", async () => {
  vi.useFakeTimers();
  areaOf(960, 540);
  window.localStorage.setItem("vch.rdp.resolution.test-server", "1920x1080");
  vi.stubGlobal("fetch", vi.fn().mockImplementation(ticketResponse));
  renderPanel();
  const socket = await openWithDesktop(1920, 1080);
  // It starts at the chosen size, not the panel's, and is scaled into the panel.
  expect(socket.url).toMatch(/\?width=1920&height=1080$/);
  expect(picture().style.width).toBe("960px");
  expect(picture().style.height).toBe("540px");
  socket.send.mockClear();
  const sizes = () => sentInstructions(socket).filter(([op]) => op === "size");
  await act(async () => { await vi.advanceTimersByTimeAsync(6_000); });
  expect(sizes().length).toBeGreaterThan(0);
  expect(sizes().every(([, w, h]) => w === "1920" && h === "1080")).toBe(true);
  // Back to following the window: the desktop is asked for the panel's size.
  fireEvent.change(screen.getByTestId("rdp-resolution"), { target: { value: "auto" } });
  expect(sizes().at(-1)).toEqual(["size", "960", "540"]);
  expect(window.localStorage.getItem("vch.rdp.resolution.test-server")).toBe("auto");
});

it("shows keyboard focus on the panel frame, not as a line around the picture", async () => {
  // A ring around the picture showed as a blue line along its edge whenever
  // the picture was smaller than the panel.
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(ticketResponse));
  renderPanel();
  await openWithDesktop(1280, 720);
  expect(screen.getByRole("application").className).not.toMatch(/ring/);
  expect(screen.getByRole("group", { name: "rdp.display" }).parentElement!.className).toMatch(/focus-within:ring-/);
});

it("shows the round trip to the hub once the bridge echoes the panel's ping", async () => {
  // A latency figure in the bar tells a slow network path from a slow desktop.
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(ticketResponse));
  renderPanel();
  const socket = await openWithDesktop(1280, 720);
  const ping = socket.send.mock.calls.map(([data]) => String(data)).find((data) => data.startsWith("0.,4.ping,"))!;
  expect(screen.queryByTestId("rdp-latency")).not.toBeInTheDocument();
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
  act(() => { socket.onmessage?.({ data: ping }); });
  expect(screen.getByTestId("rdp-latency")).toHaveTextContent("rdp.latency");
});
