"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";

import { RdpExtraKeys } from "@/components/rdp-extra-keys";
import { RdpPanControl } from "@/components/rdp-pan-control";
import { createSoftKeyboard, type SoftKeyboard } from "@/components/rdp-soft-keyboard";
import { REMOTE_DESKTOP_RESOLUTIONS, RemoteDesktopToolbar, type RemoteDesktopInputMethod, type RemoteDesktopResolution, type RemoteDesktopTouchMode } from "@/components/ssh-terminal-chrome";
import type { TerminalStatus } from "@/components/ssh-terminal-types";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { createStickyModifiers, type KeyAction, type Modifier, type ModifierStates } from "@/lib/rdp/sticky-modifiers";
import { createTouchGestures, type GestureOutput, type TouchPoint } from "@/lib/rdp/touch-gestures";
import { clampView, panBy as panViewBy, revealPoint, viewTransform, zoomAround, type ViewState } from "@/lib/rdp/view-transform";
import { cn } from "@/lib/ui/cn";
import { createRdpTunnel, rdpTicketError, rdpWebSocketUrl } from "./rdp-tunnel";

/** Bounded recovery: transient gateway drops retry, a flapping gateway gives up. */
const MAX_RECONNECT_ATTEMPTS = 8;
/**
 * Guacamole status codes for Windows refusing the account (wrong user or
 * password; locked, disabled or expired account). Retrying cannot help and
 * each attempt counts towards the account lockout.
 */
const LOGIN_REFUSED_ERRORS: Record<number, string> = { 0x0301: "rdp.error.credentials", 0x0303: "rdp.error.accountRefused", 0x031d: "rdp.error.tooMany" };
/**
 * Statuses for a session Windows ended itself: signed out or disconnected
 * inside Windows (0), taken over by another connection to the same account
 * (0x0209), the idle limit (0x020a), or ended by an administrator or the
 * session time limit (0x020b). Reconnecting would sign the account back in,
 * or take the session back from whoever has it now.
 */
const SESSION_ENDED_ERRORS: Record<number, string> = { 0x0000: "rdp.error.sessionEnded", 0x0209: "rdp.error.sessionConflict", 0x020a: "rdp.error.sessionIdle", 0x020b: "rdp.error.sessionEnded" };
/** Guacamole keysyms for the SAS (secure attention sequence) shortcut. */
const KEYSYM_CTRL = 0xffe3, KEYSYM_ALT = 0xffe9, KEYSYM_DELETE = 0xffff;
/** Guacamole keysyms of the two Shift keys. */
const KEYSYM_SHIFT_L = 0xffe1, KEYSYM_SHIFT_R = 0xffe2;
/** The Windows key, tapped on its own for the Start menu. */
const KEYSYM_WIN = 0xffeb;
/** How far the pointer stays from the edge of a zoomed or half-covered picture, in pixels. */
const POINTER_MARGIN = 28;
/** How long the long-press ring stays on screen. */
const HOLD_RING_MS = 600;
/** Where this browser remembers which input method types into remote desktops. */
const INPUT_METHOD_KEY = "vch.rdp.inputMethod";
/** Per server: `vch.rdp.resolution.<serverId>`. */
const RESOLUTION_KEY = "vch.rdp.resolution";
/** Base64 chunk size for outbound clipboard text (must stay well under the WS frame cap). */
const CLIPBOARD_CHUNK = 3072;
/** Text limit shared by both clipboard directions. */
const MAX_CLIPBOARD_CHARS = 262_144;
/** How long the touch gesture hint stays up. */
const TOUCH_HINT_MS = 6000;
/** Quiet time after the last layout change before the desktop is resized. */
const RESIZE_SETTLE_MS = 400;
/**
 * When the desktop size is asked for again after the session opened. guacd
 * replaces a size request that arrives before Windows' display channel is up
 * with the current size, so the first request can be lost; asking again only
 * resizes when the desktop still differs.
 */
const RESIZE_CONFIRM_MS = [2_500, 6_000];
/** Desktop sizes guacd and the bridge accept. */
const MIN_DESKTOP = 200, MAX_DESKTOP = 4096;
/**
 * The last desktop area a visible panel measured. A tab that connects while
 * hidden (a reconnect behind another tab) measures 0 × 0; it starts at this
 * size, which is the area it gets when shown, instead of the bridge default
 * that then needs a resize.
 */
let lastDesktopArea: { width: number; height: number } | null = null;

/**
 * The desktop size for an element's area, or null while it is hidden. The
 * width is a multiple of 4, as guacd rounds the starting width: a request for
 * any other width would resize the desktop by a few pixels right after it
 * opened, and every resize is a moment a session can be lost.
 */
function desktopArea(element: HTMLElement): { width: number; height: number } | null {
	const width = Math.floor(element.clientWidth), height = Math.floor(element.clientHeight);
	if (!width || !height) return null;
	const clamp = (n: number) => Math.max(MIN_DESKTOP, Math.min(MAX_DESKTOP, n));
	return { width: clamp(width) & ~3, height: clamp(height) };
}

/** The fixed desktop size a resolution names, or null for one that follows the panel. */
function fixedDesktop(resolution: RemoteDesktopResolution): { width: number; height: number } | null {
	if (resolution === "auto") return null;
	const [width, height] = resolution.split("x").map(Number);
	return { width: width!, height: height! };
}

function storedResolution(serverId: string): RemoteDesktopResolution {
	try {
		const value = window.localStorage.getItem(`${RESOLUTION_KEY}.${serverId}`) ?? "";
		return (REMOTE_DESKTOP_RESOLUTIONS as readonly string[]).includes(value) ? (value as RemoteDesktopResolution) : "auto";
	} catch {
		return "auto";
	}
}

function formatElapsed(seconds: number) {
	const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
	const pad = (n: number) => String(n).padStart(2, "0");
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function isTouchScreen() {
	return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

function storedInputMethod(): RemoteDesktopInputMethod {
	try {
		return window.localStorage.getItem(INPUT_METHOD_KEY) === "local" ? "local" : "remote";
	} catch {
		return "remote";
	}
}

type Phase = "connecting" | "connected" | "reconnecting" | "disconnected";

/** What the row of extra keys above the on-screen keyboard asks of the open session. */
type ExtraKeyActions = {
	down(keysym: number): void;
	repeat(keysym: number): void;
	up(keysym: number): void;
	modifier(modifier: Modifier): void;
	start(): void;
};
const NO_EXTRA_KEYS: ExtraKeyActions = { down() {}, repeat() {}, up() {}, modifier() {}, start() {} };
const NO_MODIFIERS: ModifierStates = { ctrl: "off", alt: "off", shift: "off", win: "off" };

export type RemoteDesktopPanelHandle = {
	/** The user closed this tab: end the RDP session. */
	endSession(): void;
};

export type RemoteDesktopPanelProps = {
	ref?: Ref<RemoteDesktopPanelHandle>;
	serverId: string;
	serverName: string;
	host: string;
	/** When false, the panel is hidden via CSS but keeps its session alive. */
	visible: boolean;
	onClose: () => void;
	onStatusChange?: (status: TerminalStatus) => void;
	fullscreen?: boolean;
	onToggleFullscreen?: () => void;
};

/**
 * A Windows remote desktop as a tab of the session workbench, beside SSH
 * terminals: same window, same bar, same full screen. It connects as soon
 * as the tab opens.
 *
 * Touch screens never send mouse moves — a finger drag scrolls the page —
 * so a phone could click but never move the pointer. As in Microsoft's
 * Remote Desktop app, touch input is a touchpad by default (drag moves a
 * visible pointer, tap clicks, two-finger tap right-clicks, two-finger drag
 * scrolls), or direct touch (the pointer goes where the finger is).
 *
 * Chinese and other composed text is typed with exactly one input method.
 * With both active, letters went partly to the local one and partly to the
 * remote one. By default the keys go to Windows as they are and its own
 * input method composes, like Microsoft's client: the desktop keeps the
 * focus on a non-editable element, where the browser turns the local input
 * method off. The local mode (always on touch screens, whose on-screen
 * keyboard needs a text field) lets the local input method compose and sends
 * the finished text.
 */
export function RemoteDesktopPanel({
	ref,
	serverId,
	serverName,
	host,
	visible,
	onClose,
	onStatusChange,
	fullscreen = false,
	onToggleFullscreen,
}: RemoteDesktopPanelProps) {
	const { t } = useI18n();
	const container = useRef<HTMLDivElement>(null);
	const stop = useRef<() => void>(() => {});
	const sendCtrlAltDel = useRef<() => void>(() => {});
	const refit = useRef<() => void>(() => {});
	// Lets a desktop shown again receive frames at once (see createRdpTunnel's `shown`).
	const showFrames = useRef<() => void>(() => {});
	const applyResolution = useRef<() => void>(() => {});
	const toggleKeyboard = useRef<() => void>(() => {});
	const hideKeyboard = useRef<() => void>(() => {});
	const extraKeys = useRef<ExtraKeyActions>(NO_EXTRA_KEYS);
	const panView = useRef<(dx: number, dy: number) => void>(() => {});
	const cancelTouch = useRef<() => void>(() => {});
	const applyTouchMode = useRef<() => void>(() => {});
	const applyInputMethod = useRef<() => void>(() => {});
	// An SSH tab connects when it opens; so does this one.
	const [attempt, setAttempt] = useState(1);
	const [phase, setPhase] = useState<Phase>("connecting");
	const [reconnectAttempt, setReconnectAttempt] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [clipboardError, setClipboardError] = useState<string | null>(null);
	const [resolution, setResolution] = useState<RemoteDesktopResolution>(() => storedResolution(serverId));
	const resolutionRef = useRef<RemoteDesktopResolution>(resolution);
	const [touch] = useState(isTouchScreen);
	const [touchMode, setTouchMode] = useState<RemoteDesktopTouchMode>("touchpad");
	const touchModeRef = useRef<RemoteDesktopTouchMode>(touchMode);
	const [touchHint, setTouchHint] = useState(false);
	// The on-screen keyboard, raised and lowered by its button only, and the sticky Ctrl/Alt/Shift/Win above it.
	const [keyboardOpen, setKeyboardOpen] = useState(false);
	const [modifierStates, setModifierStates] = useState<ModifierStates>(NO_MODIFIERS);
	// The picture is zoomed in (pinch) or part of it is covered by the keyboard: the pan control appears.
	const [canPan, setCanPan] = useState(false);
	// A long press registered: a ring grows where the finger is.
	const [holdRing, setHoldRing] = useState<{ x: number; y: number; id: number } | null>(null);
	// A touch screen has only the local input method: its on-screen keyboard.
	const [inputMethod, setInputMethod] = useState<RemoteDesktopInputMethod>(() => (touch ? "local" : storedInputMethod()));
	const inputMethodRef = useRef<RemoteDesktopInputMethod>(inputMethod);
	const [connectedFor, setConnectedFor] = useState(0);
	// Browser-to-hub round trip, from the tunnel's own keep-alive pings.
	const [latency, setLatency] = useState<number | null>(null);
	const visibleRef = useRef(visible);
	const connected = phase === "connected";

	const status: TerminalStatus = connected
		? "connected"
		: phase === "connecting" || phase === "reconnecting"
			? "connecting"
			: error ? "error" : "closed";
	useEffect(() => {
		onStatusChange?.(status);
	}, [status, onStatusChange]);

	useImperativeHandle(ref, () => ({ endSession: () => stop.current() }), []);

	useEffect(() => {
		if (!attempt || !container.current) return;
		const host = container.current;
		const abort = new AbortController();
		let disposed = false;
		let release = () => {};
		let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
		let reconnects = 0;
		let everConnected = false;
		let dropped = false;
		let userStopped = false;
		// Windows refused the account or ended the session: retrying cannot help.
		let finalError = false;
		const cleanup = () => {
			// Closing a tab ends the session and then unmounts it: release once,
			// never write to a tunnel that is already closed.
			if (disposed) return;
			disposed = true;
			clearTimeout(startTimer);
			clearTimeout(reconnectTimer);
			abort.abort();
			release();
			host.replaceChildren();
		};
		stop.current = () => { userStopped = true; cleanup(); setPhase("disconnected"); };
		sendCtrlAltDel.current = () => {};
		const connect = async () => {
			try {
				const response = await csrfFetch<Response>("/api/auth/rdp-ticket", {
					// csrfFetch normally returns parsed JSON; this flow needs HTTP status.
					raw: true,
					method: "POST", credentials: "same-origin", cache: "no-store",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ serverId }), signal: abort.signal,
				});
				if (!response.ok) {
					if (!disposed) setError(rdpTicketError(response.status));
					throw new Error("ticket");
				}
				const ticket: unknown = await response.json();
				if (!ticket || typeof ticket !== "object" || !("token" in ticket) || typeof ticket.token !== "string" || !("path" in ticket) || ticket.path !== "/rdp") throw new Error("ticket");
				const G = (await import("guacamole-common-js")).default;
				if (disposed) return;
				dropped = false;
				const measured = desktopArea(host);
				if (measured) lastDesktopArea = measured;
				const startArea = fixedDesktop(resolutionRef.current) ?? measured ?? lastDesktopArea;
				const tunnel = createRdpTunnel(G, rdpWebSocketUrl(window.location, startArea), ms => { if (!disposed) setLatency(ms); }, () => visibleRef.current);
				showFrames.current = () => tunnel.releaseSync();
				const client = new G.Client(tunnel);
				const display = client.getDisplay();
				const displayElement = display.getElement();
				// The browser must not scroll or zoom the page under a finger on the desktop.
				displayElement.style.touchAction = "none";
				// Own a fresh input element per session: Guacamole attaches DOM listeners.
				const surface = document.createElement("div");
				surface.tabIndex = 0;
				surface.setAttribute("role", "application");
				surface.setAttribute("aria-label", host.getAttribute("aria-label") ?? "");
				// Centred: a desktop that does not fill the panel (a fixed resolution, or
				// the moment before Windows takes a new size) sits in the middle. The
				// focus ring is the panel frame's: drawn around the picture, it showed
				// as a blue line along its edge whenever the picture was smaller.
				surface.className = "relative m-auto outline-none";
				surface.style.touchAction = "none";
				surface.appendChild(displayElement);
				// An editable focus target gives native paste, IME and the on-screen
				// keyboard to the browser. The remote display itself must never
				// become an editable DOM subtree.
				const input = document.createElement("textarea");
				input.tabIndex = -1;
				input.setAttribute("aria-label", host.dataset.inputLabel!);
				input.autocomplete = "off";
				input.autocapitalize = "off";
				input.spellcheck = false;
				input.className = "absolute left-0 top-0 h-px w-px resize-none opacity-0";
				surface.appendChild(input);
				host.replaceChildren(surface);
				const keyboard = new G.Keyboard(surface);
				const mouse = new G.Mouse(displayElement);
				const pasteKeys = new Set<number>();
				// The Ctrl/Alt/Shift/Win buttons above the on-screen keyboard are sticky: armed, they wrap the next key.
				const mods = createStickyModifiers(setModifierStates);
				const applyActions = (actions: KeyAction[]) => { for (const action of actions) client.sendKeyEvent(action.pressed ? 1 : 0, action.keysym); };
				/** What to release after a key that was pressed inside armed modifiers. */
				const releaseAfter = new Map<number, KeyAction[]>();
				// The on-screen keyboard of a touch screen: raised and lowered by its button only, never by a tap on the desktop.
				// While it is up the desktop keeps its size (the panel is half covered, and showing part of it is the way
				// Microsoft's app copes) and the extra keys above it are shown. When it goes, everything held is released.
				const softKeyboard: SoftKeyboard | null = touch ? createSoftKeyboard({
					input,
					surface,
					onChange: open => {
						setKeyboardOpen(open);
						if (!open) { applyActions(mods.reset()); resize(); }
					},
				}) : null;
				// Mac Command shortcuts use the Windows Control modifier.
				const remoteKeysym = (key: number) => key === 0xffe7 || key === 0xffe8 ? KEYSYM_CTRL : key;
				const localInput = () => touch || inputMethodRef.current === "local";
				// The remote input method mode keeps the focus on the non-editable
				// desktop. A paste lands in the text field instead (Firefox and Safari
				// fire no paste event elsewhere); the focus then comes straight back.
				const returnFocus = () => setTimeout(() => {
					if (!localInput() && document.activeElement === input) surface.focus({ preventScroll: true });
				}, 0);
				// With the local input method, a lone Shift tap is that input method
				// switching between Chinese and English. Passed on, it switched the
				// remote input method as well, and letters typed as English were
				// composed by the remote one. A Shift press waits until a key or a
				// click needs it; a lone tap never reaches Windows.
				let heldShift: number | null = null;
				const flushShift = () => {
					if (heldShift === null) return;
					const key = heldShift;
					heldShift = null;
					client.sendKeyEvent(1, key);
				};
				keyboard.onkeydown = key => {
					const modifiers = keyboard.modifiers;
					const nativePaste = !modifiers.alt && (
						((modifiers.ctrl || modifiers.meta) && (key === 0x76 || key === 0x56)) ||
						(modifiers.shift && key === 0xff63)
					);
					if (nativePaste) {
						pasteKeys.add(key);
						if (!localInput()) input.focus({ preventScroll: true });
						return true;
					}
					if (localInput() && heldShift === null && (key === KEYSYM_SHIFT_L || key === KEYSYM_SHIFT_R)) { heldShift = key; return false; }
					flushShift();
					const { before, after } = mods.wrap();
					applyActions(before);
					client.sendKeyEvent(1, remoteKeysym(key));
					if (after.length > 0) releaseAfter.set(key, after);
					return false;
				};
				keyboard.onkeyup = key => {
					if (pasteKeys.delete(key)) { returnFocus(); return; }
					if (key === heldShift) { heldShift = null; return; }
					client.sendKeyEvent(0, remoteKeysym(key));
					const after = releaseAfter.get(key);
					if (after) { releaseAfter.delete(key); applyActions(after); }
				};
				// Text composed by the local input method, or committed by it directly
				// (a "，", an on-screen keyboard word), is typed here. Guacamole's own
				// handling of these events stops typing direct input after the first
				// composition, and compositions after the first direct input — they
				// never reach it.
				let composing = false;
				let clearTimer: ReturnType<typeof setTimeout> | undefined;
				const clearInput = () => {
					clearTimeout(clearTimer);
					// Never during a composition: clearing the field cancels it, and the
					// letters typed after that went to the remote input method instead.
					clearTimer = setTimeout(() => { if (!composing) input.value = ""; }, 0);
				};
				const typeText = (text: string) => { flushShift(); keyboard.type(text); };
				input.addEventListener("compositionstart", () => { composing = true; });
				input.addEventListener("compositionend", event => {
					event.stopPropagation();
					composing = false;
					if (event.data) typeText(event.data);
					clearInput();
				});
				input.addEventListener("input", event => {
					event.stopPropagation();
					const { data, inputType, isComposing } = event as InputEvent;
					// Updates and the commit of a composition: compositionend types it.
					if (composing || isComposing || /composition/i.test(inputType ?? "")) return;
					if (data) typeText(data);
					clearInput();
				});
				// Where the picture sits in the panel: fitted, zoomed (pinch) or moved (the pan control, a pointer pushed
				// against the edge, the on-screen keyboard covering half of it). See lib/rdp/view-transform.
				let view: ViewState = { zoom: 1, x: 0, y: 0 };
				let transformed = false;
				let panning = false;
				const hostSize = () => ({ width: host.clientWidth, height: host.clientHeight });
				const pictureSize = () => ({ width: surface.offsetWidth, height: surface.offsetHeight });
				const applyView = () => {
					// A hidden tab measures 0 × 0: the view is kept until it is shown again.
					if (!host.clientWidth || !host.clientHeight || !surface.offsetWidth || !surface.offsetHeight) return;
					const viewport = hostSize(), picture = pictureSize();
					view = clampView(view, picture, viewport);
					// The centring margins already put an unzoomed picture that fits in the middle of the panel.
					const transform = viewTransform(view, Math.max(0, (viewport.width - picture.width) / 2), Math.max(0, (viewport.height - picture.height) / 2));
					surface.style.transformOrigin = "0 0";
					surface.style.transform = transform;
					transformed = transform !== "";
					panning = view.zoom > 1 || picture.width > viewport.width + 1 || picture.height > viewport.height + 1;
					setCanPan(panning);
				};
				// The remote pointer, in the desktop's own pixels, and which of its buttons are down.
				const pointer = { x: 0, y: 0, left: false, right: false };
				const sendPointer = (wheel?: "up" | "down") => {
					client.sendMouseState(new G.Mouse.State(pointer.x, pointer.y, pointer.left, false, pointer.right, wheel === "up", wheel === "down"), false);
				};
				const mouseEvents = ["mousedown", "mouseup", "mousemove"];
				// Where the mouse is on screen: Guacamole reports it against the element's layout box, which a
				// zoomed or moved picture no longer matches (see sendMouse). Seen before Guacamole sees it.
				const mouseAt = { x: 0, y: 0 };
				const recordMouse = (event: MouseEvent) => { mouseAt.x = event.clientX; mouseAt.y = event.clientY; };
				for (const type of mouseEvents) document.addEventListener(type, recordMouse as EventListener, true);
				const sendMouse = (event: import("guacamole-common-js").Event) => {
					if (!(event instanceof G.Mouse.Event)) return;
					const { left, middle, right, up, down } = event.state;
					// Shift+click and Shift+wheel need the Shift press; a mere move does not.
					if (left || middle || right || up || down) flushShift();
					if (transformed) {
						// Guacamole measures from the element's layout offset, which the CSS transform of a zoomed or moved picture
						// does not follow: a mouse on a tablet whose picture was pinched wider would point somewhere else.
						const rect = displayElement.getBoundingClientRect();
						const factor = rect.width / (display.getWidth() || 1);
						if (!(factor > 0)) return;
						const zoomedState = Object.assign(Object.create(Object.getPrototypeOf(event.state)) as typeof event.state, event.state);
						zoomedState.x = Math.min(Math.max(0, (mouseAt.x - rect.left) / factor), Math.max(0, display.getWidth() - 1));
						zoomedState.y = Math.min(Math.max(0, (mouseAt.y - rect.top) / factor), Math.max(0, display.getHeight() - 1));
						pointer.x = zoomedState.x;
						pointer.y = zoomedState.y;
						pointer.left = zoomedState.left;
						pointer.right = zoomedState.right;
						client.sendMouseState(zoomedState, false);
						return;
					}
					// An off-pixel centred desktop reports -1 at its edge (Chromium, WebKit);
					// keep the pointer on the desktop instead of sending what the gateway refuses.
					const scale = display.getScale();
					if (!(scale > 0)) return;
					const clamp = (value: number, size: number) => Math.min(Math.max(0, value), Math.max(0, size * scale - 1));
					// A copy: event.state is the mouse's own running state.
					const state = Object.assign(Object.create(Object.getPrototypeOf(event.state)) as typeof event.state, event.state);
					state.x = clamp(state.x, display.getWidth());
					state.y = clamp(state.y, display.getHeight());
					// A finger that moves the pointer next starts from where the mouse left it.
					pointer.x = state.x / scale;
					pointer.y = state.y / scale;
					pointer.left = state.left;
					pointer.right = state.right;
					client.sendMouseState(state, true);
				};
				mouse.onEach(mouseEvents, sendMouse);
				// A touchpad needs a pointer to look at; a mouse or a finger already shows where it is.
				applyTouchMode.current = () => display.showCursor(touch && touchModeRef.current === "touchpad");
				applyTouchMode.current();
				client.onclipboard = (stream, mimetype) => {
					if (mimetype.split(";")[0] !== "text/plain") { stream.sendAck("Text only", G.Status.Code.UNSUPPORTED); return; }
					const reader = new G.StringReader(stream);
					let text: string | null = "";
					reader.ontext = chunk => {
						if (text === null) return;
						if (text.length + chunk.length > MAX_CLIPBOARD_CHARS) {
							text = null;
							setClipboardError("rdp.error.clipboardSize");
							stream.sendAck("Clipboard too large", G.Status.Code.CLIENT_OVERRUN);
							return;
						}
						text += chunk;
						// guacd waits for each blob ACK before sending the next clipboard chunk.
						stream.sendAck("OK", G.Status.Code.SUCCESS);
					};
					reader.onend = () => {
						if (text === null || !document.hasFocus()) return;
						if (!navigator.clipboard) { setClipboardError("rdp.error.clipboardWrite"); return; }
						void navigator.clipboard.writeText(text).then(
							() => setClipboardError(null),
							() => setClipboardError("rdp.error.clipboardWrite"),
						);
					};
				};
				const paste = (event: ClipboardEvent) => {
					event.preventDefault();
					// WebKit can provide plain text while reporting an empty types list.
					const text = event.clipboardData?.getData("text/plain");
					if (!text) return;
					if (text.length > MAX_CLIPBOARD_CHARS) { setClipboardError("rdp.error.clipboardSize"); return; }
					setClipboardError(null);
					const stream = client.createClipboardStream("text/plain");
					const bytes = new TextEncoder().encode(text);
					for (let i = 0; i < bytes.length; i += CLIPBOARD_CHUNK) {
						let binary = "";
						for (const byte of bytes.subarray(i, i + CLIPBOARD_CHUNK)) binary += String.fromCharCode(byte);
						stream.sendBlob(btoa(binary));
					}
					stream.sendEnd();
					// Clipboard data must precede the remote paste shortcut. Temporarily
					// release physical modifiers, then restore them until their real keyup.
					// A Shift press still held back is not down on the remote side.
					const modifiers = Object.keys(keyboard.pressed).map(Number).filter(key => key >= 0xffe1 && key <= 0xffee && key !== heldShift);
					for (const key of modifiers) client.sendKeyEvent(0, remoteKeysym(key));
					client.sendKeyEvent(1, KEYSYM_CTRL);
					client.sendKeyEvent(1, 0x76);
					client.sendKeyEvent(0, 0x76);
					client.sendKeyEvent(0, KEYSYM_CTRL);
					for (const key of modifiers) client.sendKeyEvent(1, remoteKeysym(key));
					returnFocus();
				};
				surface.addEventListener("paste", paste);
				sendCtrlAltDel.current = () => {
					client.sendKeyEvent(1, KEYSYM_CTRL);
					client.sendKeyEvent(1, KEYSYM_ALT);
					client.sendKeyEvent(1, KEYSYM_DELETE);
					client.sendKeyEvent(0, KEYSYM_DELETE);
					client.sendKeyEvent(0, KEYSYM_ALT);
					client.sendKeyEvent(0, KEYSYM_CTRL);
				};
				// The text field for the local input method, the desktop itself for the
				// remote one: a non-editable focus is what turns the local one off.
				// A touch screen's text field has the focus only while its keyboard is up; otherwise the desktop does
				// (a hardware keyboard still types into it, and no keyboard rises).
				const focus = () => (localInput() && (!softKeyboard || softKeyboard.isOpen()) ? input : surface).focus({ preventScroll: true });
				toggleKeyboard.current = () => softKeyboard?.toggle();
				hideKeyboard.current = () => softKeyboard?.close();
				applyInputMethod.current = () => {
					if (document.activeElement === input || document.activeElement === surface) focus();
				};
				// A mouse click focuses the keyboard input; a tap must not, or every
				// tap would pop the on-screen keyboard over the desktop.
				const pointerFocus = (event: PointerEvent) => { if (event.pointerType === "mouse") focus(); };
				const surfaceFocus = () => { if (!touch && localInput()) input.focus({ preventScroll: true }); };
				// Leaving the page or the desktop lets go of everything held — keys, mouse buttons, and the buttons a finger holds.
				const reset = () => { keyboard.reset(); mouse.reset(); cancelTouch.current(); };
				// Moving between the desktop and its text field is not leaving it.
				const leave = (event: FocusEvent) => { if (event.relatedTarget !== input && event.relatedTarget !== surface) reset(); };
				surface.addEventListener("pointerdown", pointerFocus);
				surface.addEventListener("focus", surfaceFocus);
				input.addEventListener("blur", leave);
				surface.addEventListener("blur", leave);
				window.addEventListener("blur", reset);
				const visibility = () => { if (document.hidden) reset(); };
				document.addEventListener("visibilitychange", visibility);
				let resizeTimer: ReturnType<typeof setTimeout> | undefined;
				let confirmTimers: ReturnType<typeof setTimeout>[] = [];
				// Asks for the desktop to match the panel, or the chosen fixed size.
				// guacd only resizes when the size differs, so asking again costs nothing.
				const sendArea = () => {
					// The keyboard covers part of the panel: the desktop keeps the size it had and is asked again once it is gone.
					if (softKeyboard?.isOpen()) return;
					const fixed = fixedDesktop(resolutionRef.current);
					const area = fixed ?? desktopArea(host);
					if (!area) return;
					if (!fixed) lastDesktopArea = area;
					client.sendSize(area.width, area.height);
				};
				const applyScaleNow = () => {
					const width = display.getWidth(), height = display.getHeight();
					// A hidden tab measures 0 × 0: keep its scale rather than shrink it to nothing.
					if (!width || !height || !host.clientWidth || !host.clientHeight) return;
					if (softKeyboard?.isOpen()) { applyView(); return; }
					// Fitted both ways: capped at 1, a desktop smaller than the panel (on
					// entering full screen, until Windows takes the new size) stayed in
					// the top-left corner at its own size.
					const scale = Math.min(host.clientWidth / width, host.clientHeight / height);
					// Following the panel, the desktop is the panel's size once Windows has
					// resized it: a few pixels' difference stays pixel for pixel, unblurred.
					display.scale(!fixedDesktop(resolutionRef.current) && scale > 1 && scale < 1.05 ? 1 : scale);
					applyView();
				};
				const resize = () => {
					// A hidden tab measures 0 × 0; it is fitted again when shown.
					if (!host.clientWidth || !host.clientHeight) return;
					applyScaleNow();
					if (softKeyboard?.isOpen()) {
						// What is left of the panel shows the part of the desktop the pointer is in.
						revealPointer();
						return;
					}
					clearTimeout(resizeTimer);
					// Each resize Windows performs is a moment guacd can lose the session
					// (see the bridge), so wait for the layout to settle.
					resizeTimer = setTimeout(sendArea, RESIZE_SETTLE_MS);
				};
				applyResolution.current = () => { applyScaleNow(); sendArea(); };
				refit.current = resize;
				// A finger drives the remote mouse as Microsoft's Remote Desktop app does (see lib/rdp/touch-gestures).
				const revealPointer = () => {
					if (!panning) return;
					const scale = display.getScale();
					const next = revealPoint(view, pointer.x * scale, pointer.y * scale, POINTER_MARGIN, pictureSize(), hostSize());
					if (next !== view) { view = next; applyView(); }
				};
				const movePointer = (x: number, y: number, reveal: boolean) => {
					const width = display.getWidth(), height = display.getHeight();
					if (!width || !height) return;
					pointer.x = Math.min(Math.max(0, x), width - 1);
					pointer.y = Math.min(Math.max(0, y), height - 1);
					sendPointer();
					if (reveal) revealPointer();
				};
				/** Desktop pixels per screen pixel: the picture may be scaled down to the panel or zoomed in on. */
				const desktopPerScreen = () => {
					const width = displayElement.getBoundingClientRect().width;
					return width > 0 && display.getWidth() ? display.getWidth() / width : 0;
				};
				let afterClick: KeyAction[] = [];
				const gestureOutput: GestureOutput = {
					pointerMoveBy(dx, dy) {
						const k = desktopPerScreen();
						if (k) movePointer(pointer.x + dx * k, pointer.y + dy * k, true);
					},
					pointerMoveTo(x, y) {
						const k = desktopPerScreen();
						if (!k) return;
						const rect = displayElement.getBoundingClientRect();
						movePointer((x - rect.left) * k, (y - rect.top) * k, false);
					},
					button(which, pressed) {
						if (pressed) {
							flushShift();
							// Ctrl-click and the like: a modifier armed among the extra keys goes down with the click.
							const wrapped = mods.wrap();
							applyActions(wrapped.before);
							afterClick = wrapped.after;
							// A hardware keyboard types into the desktop, unless the on-screen keyboard has the focus.
							if (!softKeyboard?.isOpen() && document.activeElement !== surface) surface.focus({ preventScroll: true });
						}
						pointer[which] = pressed;
						sendPointer();
						if (!pressed && !pointer.left && !pointer.right && afterClick.length > 0) { applyActions(afterClick); afterClick = []; }
					},
					wheel(notches) {
						flushShift();
						for (let i = 0; i < Math.abs(notches); i += 1) { sendPointer(notches > 0 ? "down" : "up"); sendPointer(); }
					},
					zoomBy(factor, x, y) {
						const box = host.getBoundingClientRect();
						view = zoomAround(view, factor, x - box.left, y - box.top, pictureSize(), hostSize());
						applyView();
					},
					panBy(dx, dy) {
						view = panViewBy(view, dx, dy, pictureSize(), hostSize());
						applyView();
					},
					holdRegistered(x, y) {
						const box = host.getBoundingClientRect();
						setHoldRing(ring => ({ x: x - box.left, y: y - box.top, id: (ring?.id ?? 0) + 1 }));
						navigator.vibrate?.(12);
					},
				};
				const gestures = createTouchGestures(gestureOutput, () => (touchModeRef.current === "touch" ? "direct" : "pointer"));
				cancelTouch.current = () => gestures.cancel();
				panView.current = (dx, dy) => { view = panViewBy(view, dx, dy, pictureSize(), hostSize()); applyView(); };
				// Only fingers that came down on the desktop are its gestures; the keyboard buttons and the pan control are theirs.
				const fingers = (list: TouchList) => {
					const points: TouchPoint[] = [];
					for (let i = 0; i < list.length; i += 1) {
						const finger = list[i]!;
						if (finger.target instanceof Node && host.contains(finger.target)) points.push({ id: finger.identifier, x: finger.clientX, y: finger.clientY });
					}
					return points;
				};
				// Every touch on the desktop is ours: no scrolling, page zoom, long-press menu, focus change (which would
				// lower the keyboard) or emulated mouse events under a finger.
				const touchStep = (step: (points: TouchPoint[]) => void) => (event: TouchEvent) => {
					if (event.cancelable) event.preventDefault();
					step(fingers(event.touches));
				};
				const onTouchStart = touchStep(points => gestures.start(points));
				const onTouchMove = touchStep(points => gestures.move(points));
				const onTouchEnd = touchStep(points => gestures.end(points));
				const onTouchCancel = () => gestures.cancel();
				const noDefault = (event: Event) => event.preventDefault();
				host.addEventListener("touchstart", onTouchStart, { passive: false });
				host.addEventListener("touchmove", onTouchMove, { passive: false });
				host.addEventListener("touchend", onTouchEnd, { passive: false });
				host.addEventListener("touchcancel", onTouchCancel);
				host.addEventListener("gesturestart", noDefault);
				if (touch) host.addEventListener("contextmenu", noDefault);
				// The extra keys above the keyboard: Esc, Tab, arrows, F-keys and the sticky Ctrl/Alt/Shift/Win.
				const extraAfter = new Map<number, KeyAction[]>();
				extraKeys.current = {
					down(keysym) {
						flushShift();
						const wrapped = mods.wrap();
						applyActions(wrapped.before);
						client.sendKeyEvent(1, keysym);
						if (wrapped.after.length > 0) extraAfter.set(keysym, wrapped.after);
					},
					// A held key repeats as a physical keyboard's does: Windows does not repeat what a remote client presses.
					repeat(keysym) { client.sendKeyEvent(1, keysym); },
					up(keysym) {
						client.sendKeyEvent(0, keysym);
						const after = extraAfter.get(keysym);
						if (after) { extraAfter.delete(keysym); applyActions(after); }
					},
					modifier(modifier) { flushShift(); applyActions(mods.tap(modifier)); },
					start() { client.sendKeyEvent(1, KEYSYM_WIN); client.sendKeyEvent(0, KEYSYM_WIN); },
				};
				// The pointer starts in the middle of the desktop, where a thumb finds it — once the desktop has
				// a size (it arrives just after the session opens).
				let pointerCentered = false;
				const centerPointer = () => {
					if (pointerCentered || !touch || !display.getWidth() || !display.getHeight()) return;
					pointerCentered = true;
					pointer.x = display.getWidth() / 2;
					pointer.y = display.getHeight() / 2;
					if (touchModeRef.current === "touchpad") sendPointer();
				};
				const observer = new ResizeObserver(resize);
				observer.observe(host);
				display.onresize = () => {
					applyScaleNow();
					centerPointer();
					// The desktop may have become smaller than where the pointer was.
					pointer.x = Math.min(pointer.x, Math.max(0, display.getWidth() - 1));
					pointer.y = Math.min(pointer.y, Math.max(0, display.getHeight() - 1));
				};
				release = () => {
					reset();
					keyboard.onkeydown = keyboard.onkeyup = null;
					mouse.offEach(mouseEvents, sendMouse);
					for (const type of mouseEvents) document.removeEventListener(type, recordMouse as EventListener, true);
					surface.removeEventListener("paste", paste);
					surface.removeEventListener("pointerdown", pointerFocus);
					surface.removeEventListener("focus", surfaceFocus);
					input.removeEventListener("blur", leave);
					surface.removeEventListener("blur", leave);
					window.removeEventListener("blur", reset);
					clearTimeout(clearTimer);
					document.removeEventListener("visibilitychange", visibility);
					observer.disconnect(); clearTimeout(resizeTimer); confirmTimers.forEach(clearTimeout); confirmTimers = [];
					client.onerror = client.onstatechange = client.onclipboard = null;
					display.onresize = null;
					host.removeEventListener("touchstart", onTouchStart);
					host.removeEventListener("touchmove", onTouchMove);
					host.removeEventListener("touchend", onTouchEnd);
					host.removeEventListener("touchcancel", onTouchCancel);
					host.removeEventListener("gesturestart", noDefault);
					host.removeEventListener("contextmenu", noDefault);
					gestures.dispose();
					softKeyboard?.dispose();
					mods.reset();
					setKeyboardOpen(false);
					setCanPan(false);
					toggleKeyboard.current = () => {};
					hideKeyboard.current = () => {};
					extraKeys.current = NO_EXTRA_KEYS;
					panView.current = () => {};
					cancelTouch.current = () => {};
					applyResolution.current = () => {};
					applyTouchMode.current = () => {};
					applyInputMethod.current = () => {};
					client.disconnect();
				};
				const drop = () => {
					if (disposed || dropped) return;
					dropped = true;
					release();
					host.replaceChildren();
					// Only an established session auto-reconnects — a failed first
					// connect must leave its error message on screen, not loop.
					if (everConnected && !userStopped && !finalError && reconnects < MAX_RECONNECT_ATTEMPTS) {
						reconnects += 1;
						setReconnectAttempt(reconnects);
						setPhase("reconnecting");
						reconnectTimer = setTimeout(() => { dropped = false; void connect(); }, Math.min(3_000 * 2 ** (reconnects - 1), 60_000));
						return;
					}
					setPhase("disconnected");
					if (!userStopped && everConnected) setError(previous => previous ?? "rdp.error.connection");
				};
				const failed = (status?: { code?: number }) => {
					if (disposed) return;
					const code = status?.code;
					const final = code === undefined ? undefined : LOGIN_REFUSED_ERRORS[code] ?? SESSION_ENDED_ERRORS[code];
					if (final) {
						// Windows answered (the session is "ready" first): say why, do not retry.
						finalError = true;
						setError(final);
					}
					if (everConnected) drop();
					else { setError(final ?? "rdp.error.connection"); setPhase("disconnected"); cleanup(); }
				};
				client.onerror = failed;
				tunnel.onerror = failed;
				tunnel.onstatechange = state => {
					if (disposed) return;
					// The bridge only delivers the UUID after guacd reports the RDP
					// session ready, so OPEN is the earliest safe reconnect point.
					if (state === G.Tunnel.State.OPEN) everConnected = true;
					else if (state === G.Tunnel.State.CLOSED) drop();
				};
				client.onstatechange = state => {
					if (disposed) return;
					if (state === 3) {
						setPhase("connected"); setError(null); reconnects = 0; setReconnectAttempt(0);
						resize();
						confirmTimers.forEach(clearTimeout);
						confirmTimers = RESIZE_CONFIRM_MS.map(delay => setTimeout(sendArea, delay));
						if (touch) {
							centerPointer();
							// The desktop has the focus (a hardware keyboard types into it); the on-screen keyboard is the button's.
							if (visibleRef.current) surface.focus({ preventScroll: true });
							setTouchHint(true);
						} else if (visibleRef.current) {
							focus();
						}
					}
					if (state === 5) drop();
				};
				client.connect(ticket.token);
			} catch {
				if (!disposed) {
					setError(previous => previous ?? "rdp.error.connection");
					setPhase("disconnected"); cleanup();
				}
			}
		};
		// One tick later: a mount undone at once (React's development double
		// mount) must not fetch a ticket and open a session of its own.
		const startTimer = setTimeout(() => void connect(), 0);
		return cleanup;
	}, [attempt, serverId, touch]);

	// A resolution change never reconnects: the live desktop is resized and fitted.
	useEffect(() => {
		resolutionRef.current = resolution;
		applyResolution.current();
	}, [resolution]);

	useEffect(() => {
		touchModeRef.current = touchMode;
		applyTouchMode.current();
		// A drag begun in the other mode must not go on in this one.
		cancelTouch.current();
	}, [touchMode]);

	useEffect(() => {
		inputMethodRef.current = inputMethod;
		applyInputMethod.current();
	}, [inputMethod]);

	const changeResolution = (next: RemoteDesktopResolution) => {
		setResolution(next);
		try {
			window.localStorage.setItem(`${RESOLUTION_KEY}.${serverId}`, next);
		} catch {
			// Not remembered (private window or blocked storage); this tab still switches.
		}
	};

	const toggleInputMethod = () => {
		const next: RemoteDesktopInputMethod = inputMethod === "remote" ? "local" : "remote";
		setInputMethod(next);
		try {
			window.localStorage.setItem(INPUT_METHOD_KEY, next);
		} catch {
			// Not remembered (private window or blocked storage); this tab still switches.
		}
	};

	// A tab shown again (or the window resized while it was hidden) is fitted now.
	useEffect(() => {
		visibleRef.current = visible;
		if (!visible) return;
		refit.current();
		showFrames.current();
	}, [visible, fullscreen]);

	useEffect(() => {
		if (!holdRing) return;
		const timer = setTimeout(() => setHoldRing(null), HOLD_RING_MS);
		return () => clearTimeout(timer);
	}, [holdRing]);

	useEffect(() => {
		if (!touchHint) return;
		const timer = setTimeout(() => setTouchHint(false), TOUCH_HINT_MS);
		return () => clearTimeout(timer);
	}, [touchHint, touchMode]);

	useEffect(() => {
		if (!connected) return;
		const openedAt = Date.now();
		const timer = setInterval(() => setConnectedFor(Math.floor((Date.now() - openedAt) / 1000)), 1000);
		return () => { clearInterval(timer); setConnectedFor(0); };
	}, [connected]);

	const reconnect = () => {
		stop.current();
		setError(null);
		setClipboardError(null);
		setPhase("connecting");
		setAttempt(value => value + 1);
	};

	const overlay = phase === "connected"
		? null
		: phase === "reconnecting"
			? t("rdp.status.reconnecting", { attempt: reconnectAttempt })
			: phase === "connecting"
				? t("rdp.status.connecting")
				: error ? t(error) : t("rdp.status.disconnected");

	return (
		<div
			className="flex min-h-0 flex-1 flex-col"
			style={{ display: visible ? "flex" : "none" }}
			data-testid={`rdp-panel-${serverId}`}
		>
			<RemoteDesktopToolbar
				serverName={serverName}
				host={host}
				status={status}
				t={t}
				fullscreen={fullscreen}
				touch={touch}
				touchMode={touchMode}
				keyboardOpen={keyboardOpen}
				inputMethod={inputMethod}
				resolution={resolution}
				elapsed={connected ? formatElapsed(connectedFor) : null}
				latency={connected ? latency : null}
				onToggleTouchMode={() => { setTouchMode(mode => mode === "touchpad" ? "touch" : "touchpad"); setTouchHint(true); }}
				onKeyboard={() => toggleKeyboard.current()}
				onToggleInputMethod={toggleInputMethod}
				onResolutionChange={changeResolution}
				onCtrlAltDel={() => sendCtrlAltDel.current()}
				onToggleFullscreen={onToggleFullscreen}
				onReconnect={reconnect}
				onClose={onClose}
			/>
			<div className={cn("flex min-h-0 flex-1 flex-col", fullscreen ? "p-1" : "p-3")}>
				<div
					className={cn(
						"relative flex min-h-0 min-w-0 flex-1 overflow-hidden bg-black focus-within:ring-[var(--accent)]",
						fullscreen ? "rounded-lg focus-within:ring-1" : "rounded-xl border border-[var(--border-subtle)] light:border-[var(--border)] focus-within:ring-2",
					)}
				>
					<div
						ref={container}
						role="group"
						data-input-label={t("rdp.input")}
						aria-label={t("rdp.display")}
						className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
						style={{ touchAction: "none" }}
					/>
					{overlay ? (
						<p
							role={error ? "alert" : "status"}
							className={cn(
								"pointer-events-none absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-sm",
								error && phase === "disconnected" ? "text-[var(--danger)]" : "text-[var(--text-secondary)]",
							)}
							data-testid="rdp-overlay"
						>
							{overlay}
						</p>
					) : null}
					{canPan && connected ? <RdpPanControl label={t("rdp.pan.label")} onPan={(dx, dy) => panView.current(dx, dy)} /> : null}
					{holdRing ? (
						<span
							key={holdRing.id}
							aria-hidden="true"
							data-testid="rdp-hold-ring"
							className="pointer-events-none absolute h-14 w-14 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-[var(--accent)]"
							style={{ left: holdRing.x, top: holdRing.y }}
						/>
					) : null}
					{/* Floating notes: a bar above the desktop would resize the remote session. */}
					{clipboardError ? (
						<p role="alert" data-popover className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-1.5rem)] px-3 py-2 text-xs text-[var(--warning)] sm:max-w-sm">
							{t(clipboardError)}
						</p>
					) : touchHint && connected ? (
						<p role="status" data-popover className="pointer-events-none absolute bottom-3 left-3 max-w-[calc(100%-6rem)] px-3 py-2 text-xs text-[var(--text-secondary)] sm:max-w-sm" data-testid="rdp-touch-hint">
							{t(touchMode === "touchpad" ? "rdp.pointer.touchpadHint" : "rdp.pointer.touchHint")}
						</p>
					) : null}
				</div>
			</div>
			{touch && keyboardOpen && connected ? (
				<RdpExtraKeys
					t={t}
					modifiers={modifierStates}
					onModifier={modifier => extraKeys.current.modifier(modifier)}
					onKeyDown={keysym => extraKeys.current.down(keysym)}
					onKeyRepeat={keysym => extraKeys.current.repeat(keysym)}
					onKeyUp={keysym => extraKeys.current.up(keysym)}
					onStart={() => extraKeys.current.start()}
					onHideKeyboard={() => hideKeyboard.current()}
				/>
			) : null}
		</div>
	);
}
