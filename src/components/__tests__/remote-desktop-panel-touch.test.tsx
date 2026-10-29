import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { instruction, GuacParser } from "@/lib/rdp/protocol";
import { RemoteDesktopPanel, type RemoteDesktopPanelHandle } from "../remote-desktop-panel";

/**
 * The remote desktop on a phone: fingers drive the remote mouse as in Microsoft's Remote Desktop app,
 * and the on-screen keyboard is raised and lowered by its button only. Guacamole, the tunnel and the
 * panel are real; the browser's layout is stubbed: an 800 × 600 desktop shown at half size in a
 * 400 × 300 panel at the origin of the screen.
 */
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key }) }));

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
let panelResized: Array<() => void> = [];
let panelHeight = 300;

beforeEach(() => {
  Socket.instances = [];
  panelResized = [];
  panelHeight = 300;
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { panelResized.push(callback); }
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query === "(pointer: coarse)", media: query, addEventListener() {}, removeEventListener() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(new Proxy({}, {
    get: (_target, key) => key === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : vi.fn(),
  }) as CanvasRenderingContext2D);
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(() => panelHeight);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(300);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 300, width: 400, height: 300, toJSON() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

async function connectedTouchDesktop() {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: "test-ticket", path: "/rdp" }), { status: 200 })));
  render(<RemoteDesktopPanel ref={createRef<RemoteDesktopPanelHandle>()} serverId="test-server" serverName="win" host="192.0.2.1" visible onClose={vi.fn()} />);
  await waitFor(() => expect(Socket.instances).toHaveLength(1));
  const socket = Socket.instances[0]!;
  act(() => {
    socket.onopen?.();
    socket.onmessage?.({ data: instruction("", "uuid") + instruction("size", "0", "800", "600") + instruction("sync", "1") });
  });
  // The display applies its size on the next animation frame.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
  socket.send.mockClear();
  const surface = screen.getByRole("application");
  return { socket, surface, desktop: surface.firstElementChild!, input: screen.getByRole("textbox", { name: "rdp.input" }) };
}

function sentInstructions(socket: Socket) {
  const rows: string[][] = [];
  const parser = new GuacParser(row => rows.push(row));
  for (const [data] of socket.send.mock.calls) parser.feed(data);
  return rows;
}
const mouseRows = (socket: Socket) => sentInstructions(socket).filter(row => row[0] === "mouse");
const keyRows = (socket: Socket) => sentInstructions(socket).filter(row => row[0] === "key").map(row => row.slice(1));
const sizeRows = (socket: Socket) => sentInstructions(socket).filter(row => row[0] === "size");

type Finger = { id: number; x: number; y: number };
/** One touch event as the browser delivers it: `touches` lists every finger still on the screen. Returns false when cancelled. */
function touch(target: Element, type: "touchstart" | "touchmove" | "touchend" | "touchcancel", onScreen: Finger[]) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "touches", { value: onScreen.map(({ id, x, y }) => ({ identifier: id, clientX: x, clientY: y, target })) });
  return fireEvent(target, event);
}
const tap = (target: Element, x: number, y: number) => {
  touch(target, "touchstart", [{ id: 1, x, y }]);
  touch(target, "touchend", []);
};
const wait = (ms: number) => act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); });

it("raises the on-screen keyboard with its button only and lowers it with the same button", async () => {
  const { desktop, surface, input } = await connectedTouchDesktop();
  const chip = screen.getByTestId("rdp-keyboard");
  expect(chip).toHaveAttribute("aria-pressed", "false");

  // Tapping the desktop never raises the keyboard, and no emulated mouse event can move the focus.
  expect(touch(desktop, "touchstart", [{ id: 1, x: 100, y: 100 }])).toBe(false);
  touch(desktop, "touchend", []);
  expect(input).not.toHaveFocus();
  expect(input.inputMode).toBe("none");

  // The press on the button leaves the focus where it is: moving it would lower the keyboard before the click.
  expect(fireEvent.mouseDown(chip)).toBe(false);
  fireEvent.click(chip);
  expect(input).toHaveFocus();
  expect(input.inputMode).toBe("text");
  expect(chip).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByTestId("rdp-extra-keys")).toBeInTheDocument();

  // With the keyboard up, a tap on the desktop leaves it up.
  tap(desktop, 100, 100);
  expect(input).toHaveFocus();

  fireEvent.click(chip);
  expect(input).not.toHaveFocus();
  expect(input.inputMode).toBe("none");
  expect(surface).toHaveFocus();
  expect(chip).toHaveAttribute("aria-pressed", "false");
  expect(screen.queryByTestId("rdp-extra-keys")).not.toBeInTheDocument();
});

it("moves the pointer like a touchpad and clicks where the pointer is (mouse pointer mode)", async () => {
  const { socket, desktop } = await connectedTouchDesktop();
  // A tap is a left click at the pointer, which starts in the middle of the desktop — not under the finger.
  tap(desktop, 50, 50);
  expect(mouseRows(socket)).toEqual([["mouse", "400", "300", "1"], ["mouse", "400", "300", "0"]]);
  socket.send.mockClear();

  // A touch right after a tap would be its second half (a double click, or tap-and-drag).
  await wait(350);
  // 60 px of finger across the half-size picture is 120 desktop pixels.
  touch(desktop, "touchstart", [{ id: 1, x: 100, y: 100 }]);
  touch(desktop, "touchmove", [{ id: 1, x: 160, y: 100 }]);
  touch(desktop, "touchend", []);
  expect(mouseRows(socket)).toEqual([["mouse", "520", "300", "0"]]);
});

it("right-clicks with a two-finger tap and scrolls with a two-finger drag", async () => {
  const { socket, desktop } = await connectedTouchDesktop();
  const a = { id: 1, x: 100, y: 150 }, b = { id: 2, x: 160, y: 150 };
  touch(desktop, "touchstart", [a]);
  touch(desktop, "touchstart", [a, b]);
  touch(desktop, "touchend", [b]);
  touch(desktop, "touchend", []);
  expect(mouseRows(socket)).toEqual([["mouse", "400", "300", "4"], ["mouse", "400", "300", "0"]]);
  socket.send.mockClear();

  // Both fingers up by 60 px: the content follows them, which is two notches of the wheel downwards.
  await wait(400);
  touch(desktop, "touchstart", [a]);
  touch(desktop, "touchstart", [a, b]);
  touch(desktop, "touchmove", [{ ...a, y: 90 }, { ...b, y: 90 }]);
  touch(desktop, "touchend", [{ ...b, y: 90 }]);
  touch(desktop, "touchend", []);
  expect(mouseRows(socket)).toEqual([
    ["mouse", "400", "300", "16"], ["mouse", "400", "300", "0"],
    ["mouse", "400", "300", "16"], ["mouse", "400", "300", "0"],
  ]);
});

it("clicks under the finger in direct touch mode, and right-clicks on a tap and hold", async () => {
  const { socket, desktop } = await connectedTouchDesktop();
  fireEvent.click(screen.getByTestId("rdp-pointer-mode"));
  expect(screen.getByTestId("rdp-pointer-mode")).toHaveAccessibleName("rdp.pointer.touch");
  socket.send.mockClear();

  tap(desktop, 100, 80);
  const clicked = mouseRows(socket);
  // The finger hovers where it lands, then clicks there.
  expect(clicked[0]).toEqual(["mouse", "200", "160", "0"]);
  expect(clicked.slice(-2)).toEqual([["mouse", "200", "160", "1"], ["mouse", "200", "160", "0"]]);
  socket.send.mockClear();

  touch(desktop, "touchstart", [{ id: 1, x: 100, y: 80 }]);
  await wait(560);
  expect(screen.getByTestId("rdp-hold-ring")).toBeInTheDocument();
  touch(desktop, "touchend", []);
  expect(mouseRows(socket).slice(-2)).toEqual([["mouse", "200", "160", "4"], ["mouse", "200", "160", "0"]]);
});

it("zooms with a pinch and offers the pan control; a mouse still points where it is", async () => {
  const { socket, surface, desktop } = await connectedTouchDesktop();
  expect(screen.queryByTestId("rdp-pan-control")).not.toBeInTheDocument();
  touch(desktop, "touchstart", [{ id: 1, x: 150, y: 150 }]);
  touch(desktop, "touchstart", [{ id: 1, x: 150, y: 150 }, { id: 2, x: 250, y: 150 }]);
  touch(desktop, "touchmove", [{ id: 1, x: 100, y: 150 }, { id: 2, x: 300, y: 150 }]);
  touch(desktop, "touchend", [{ id: 2, x: 300, y: 150 }]);
  touch(desktop, "touchend", []);
  expect(surface.style.transform).toMatch(/scale\(2\.0/);
  expect(screen.getByTestId("rdp-pan-control")).toBeInTheDocument();

  // Guacamole measures a mouse from the element's layout box, which the zoomed picture has left.
  // (It ignores the first few mouse events after touch ones, which are usually emulated.)
  socket.send.mockClear();
  for (let i = 0; i < 4; i += 1) fireEvent.mouseMove(desktop, { clientX: 100, clientY: 60 });
  expect(mouseRows(socket).at(-1)).toEqual(["mouse", "200", "120", "0"]);
});

it("sends the extra keys, with a modifier armed for the next key and locked by a second tap", async () => {
  const { socket } = await connectedTouchDesktop();
  const press = (id: string) => {
    fireEvent.pointerDown(screen.getByTestId(`rdp-key-${id}`));
    fireEvent.pointerUp(screen.getByTestId(`rdp-key-${id}`));
  };
  fireEvent.click(screen.getByTestId("rdp-keyboard"));

  press("esc");
  expect(keyRows(socket)).toEqual([["65307", "1"], ["65307", "0"]]);
  socket.send.mockClear();

  // Ctrl, then Tab: Ctrl is held for that key only.
  fireEvent.click(screen.getByTestId("rdp-key-ctrl"));
  expect(screen.getByTestId("rdp-key-ctrl")).toHaveAttribute("data-state", "armed");
  press("tab");
  expect(keyRows(socket)).toEqual([["65507", "1"], ["65289", "1"], ["65289", "0"], ["65507", "0"]]);
  expect(screen.getByTestId("rdp-key-ctrl")).toHaveAttribute("data-state", "off");
  socket.send.mockClear();

  // Twice locks it: it stays down for every key until the third tap …
  fireEvent.click(screen.getByTestId("rdp-key-ctrl"));
  fireEvent.click(screen.getByTestId("rdp-key-ctrl"));
  expect(screen.getByTestId("rdp-key-ctrl")).toHaveAttribute("data-state", "locked");
  press("tab");
  press("tab");
  expect(keyRows(socket)).toEqual([["65507", "1"], ["65289", "1"], ["65289", "0"], ["65289", "1"], ["65289", "0"]]);
  socket.send.mockClear();

  // … or until the keyboard is lowered, so nothing stays held behind a bar that is gone.
  fireEvent.click(screen.getByTestId("rdp-keyboard"));
  expect(keyRows(socket)).toEqual([["65507", "0"]]);
});

it("holds an armed modifier through a tap on the desktop, for Ctrl-click", async () => {
  const { socket, desktop } = await connectedTouchDesktop();
  fireEvent.click(screen.getByTestId("rdp-keyboard"));
  fireEvent.click(screen.getByTestId("rdp-key-ctrl"));
  socket.send.mockClear();
  tap(desktop, 50, 50);
  const rows = sentInstructions(socket).filter(row => row[0] === "key" || row[0] === "mouse");
  expect(rows).toEqual([
    ["key", "65507", "1"], ["mouse", "400", "300", "1"], ["mouse", "400", "300", "0"], ["key", "65507", "0"],
  ]);
});

it("keeps the desktop's size while the keyboard covers part of the panel, and asks again when it is gone", async () => {
  const { socket } = await connectedTouchDesktop();
  fireEvent.click(screen.getByTestId("rdp-keyboard"));
  // The keyboard takes half of the panel.
  panelHeight = 150;
  act(() => panelResized.forEach(callback => callback()));
  await wait(450);
  expect(sizeRows(socket)).toEqual([]);

  fireEvent.click(screen.getByTestId("rdp-keyboard"));
  panelHeight = 300;
  act(() => panelResized.forEach(callback => callback()));
  await wait(450);
  expect(sizeRows(socket).length).toBeGreaterThan(0);
});

it("lets go of a button a finger holds when the page loses the focus", async () => {
  const { socket, desktop } = await connectedTouchDesktop();
  fireEvent.click(screen.getByTestId("rdp-pointer-mode"));
  socket.send.mockClear();
  // Direct touch: a drag holds the left button from where the finger came down.
  touch(desktop, "touchstart", [{ id: 1, x: 100, y: 100 }]);
  touch(desktop, "touchmove", [{ id: 1, x: 140, y: 100 }]);
  expect(mouseRows(socket).some(row => row[3] === "1")).toBe(true);
  socket.send.mockClear();
  fireEvent.blur(window);
  expect(mouseRows(socket)).toEqual([["mouse", "280", "200", "0"]]);
});

it("opens the Start menu with a tap on Win, and uses a held Win as a modifier", async () => {
  const { socket } = await connectedTouchDesktop();
  fireEvent.click(screen.getByTestId("rdp-keyboard"));
  const win = screen.getByTestId("rdp-key-win");
  socket.send.mockClear();
  fireEvent.pointerDown(win);
  fireEvent.pointerUp(win);
  expect(keyRows(socket)).toEqual([["65515", "1"], ["65515", "0"]]);
  socket.send.mockClear();

  // Held a moment it is armed instead — nothing is sent until the next key, which it joins (Win+R).
  fireEvent.pointerDown(win);
  await wait(450);
  fireEvent.pointerUp(win);
  expect(win).toHaveAttribute("data-state", "armed");
  expect(keyRows(socket)).toEqual([]);
  fireEvent.pointerDown(screen.getByTestId("rdp-key-tab"));
  fireEvent.pointerUp(screen.getByTestId("rdp-key-tab"));
  expect(keyRows(socket)).toEqual([["65515", "1"], ["65289", "1"], ["65289", "0"], ["65515", "0"]]);
});

it("repeats a held arrow key as a keyboard does", async () => {
  const { socket } = await connectedTouchDesktop();
  fireEvent.click(screen.getByTestId("rdp-keyboard"));
  const right = screen.getByTestId("rdp-key-right");
  socket.send.mockClear();
  fireEvent.pointerDown(right);
  await wait(600);
  fireEvent.pointerUp(right);
  const rows = keyRows(socket);
  expect(rows[0]).toEqual(["65363", "1"]);
  // After the first press: repeated key-downs, then one release.
  expect(rows.filter(row => row[1] === "1").length).toBeGreaterThan(2);
  expect(rows.at(-1)).toEqual(["65363", "0"]);
  const before = rows.length;
  await wait(200);
  expect(keyRows(socket).length).toBe(before);
});
