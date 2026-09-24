"use client";

import { useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/action-button";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Notice } from "@/components/ui-primitives";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { createRdpTunnel, rdpTicketError, rdpWebSocketUrl } from "./rdp-tunnel";

/** Bounded recovery: transient gateway drops retry, a flapping gateway gives up. */
const MAX_RECONNECT_ATTEMPTS = 8;
/** Guacamole keysyms for the SAS (secure attention sequence) shortcut. */
const KEYSYM_CTRL = 0xffe3, KEYSYM_ALT = 0xffe9, KEYSYM_DELETE = 0xffff;
/** Base64 chunk size for outbound clipboard text (must stay well under the WS frame cap). */
const CLIPBOARD_CHUNK = 3072;
/** Drop oversized remote clipboards instead of exhausting the local clipboard API. */
const MAX_INBOUND_CLIPBOARD_CHARS = 262_144;

function formatElapsed(seconds: number) {
 const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
 const pad = (n: number) => String(n).padStart(2, "0");
 return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

type ViewMode = "fit" | "actual";

export function RemoteDesktop({ serverId }: { serverId: string }) {
 const { t } = useI18n();
 const container = useRef<HTMLDivElement>(null);
 const stop = useRef<() => void>(() => {});
 const sendCtrlAltDel = useRef(() => {});
 const applyScale = useRef<() => void>(() => {});
 const [attempt, setAttempt] = useState(0);
 const [status, setStatus] = useState("rdp.status.idle");
 const [reconnectAttempt, setReconnectAttempt] = useState(0);
 const [error, setError] = useState<string | null>(null);
 const [viewMode, setViewMode] = useState<ViewMode>("fit");
 const viewModeRef = useRef<ViewMode>(viewMode);
 const [fullscreen, setFullscreen] = useState(false);
 const [connectedFor, setConnectedFor] = useState(0);
 const connected = status === "rdp.status.connected";
 const active = status === "rdp.status.connecting" || connected || status === "rdp.status.reconnecting";

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
  const cleanup = () => {
   disposed = true;
   clearTimeout(reconnectTimer);
   abort.abort();
   release();
   host.replaceChildren();
  };
  stop.current = () => { userStopped = true; cleanup(); setStatus("rdp.status.disconnected"); };
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
    const tunnel = createRdpTunnel(G, rdpWebSocketUrl(window.location));
    const client = new G.Client(tunnel);
    const display = client.getDisplay();
    // Own a fresh input element per session: Guacamole attaches DOM listeners.
    const surface = document.createElement("div");
    surface.tabIndex = 0;
    surface.setAttribute("role", "application");
    surface.setAttribute("aria-label", host.getAttribute("aria-label") ?? "");
    surface.className = "outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]";
    surface.appendChild(display.getElement());
    host.replaceChildren(surface);
    const keyboard = new G.Keyboard(surface);
    const mouse = new G.Mouse(display.getElement());
    keyboard.onkeydown = key => { client.sendKeyEvent(1, key); return false; };
    keyboard.onkeyup = key => client.sendKeyEvent(0, key);
    const mouseEvents = ["mousedown", "mouseup", "mousemove"];
    const sendMouse = (event: import("guacamole-common-js").Event) => {
     if (event instanceof G.Mouse.Event) client.sendMouseState(event.state, true);
    };
    mouse.onEach(mouseEvents, sendMouse);
    // Clipboard sync, both directions, text only. Inbound plays into the local
    // clipboard when the browser grants write access; outbound is sent on paste
    // while the desktop surface holds focus. The gateway may still disable the
    // channel per deployment (RDP_ENABLE_CLIPBOARD) — it then rejects the stream.
    client.onclipboard = (stream, mimetype) => {
     if (String(mimetype).split(";")[0] !== "text/plain") { stream.sendAck("Text only", G.Status.Code.UNSUPPORTED); return; }
     const reader = new G.StringReader(stream);
     let text = "";
     reader.ontext = chunk => { if (text.length <= MAX_INBOUND_CLIPBOARD_CHARS) text += chunk; };
     reader.onend = () => {
      stream.sendAck("OK", G.Status.Code.SUCCESS);
      if (text && document.hasFocus() && navigator.clipboard) void navigator.clipboard.writeText(text.slice(0, MAX_INBOUND_CLIPBOARD_CHARS)).catch(() => {});
     };
    };
    const sendClipboardText = (text: string) => {
     const stream = client.createClipboardStream("text/plain");
     const bytes = new TextEncoder().encode(text.slice(0, MAX_INBOUND_CLIPBOARD_CHARS));
     for (let i = 0; i < bytes.length; i += CLIPBOARD_CHUNK) {
      let binary = "";
      const chunk = bytes.subarray(i, i + CLIPBOARD_CHUNK);
      for (let j = 0; j < chunk.length; j++) binary += String.fromCharCode(chunk[j]!);
      stream.sendBlob(btoa(binary));
     }
     stream.sendEnd();
    };
    const paste = (event: ClipboardEvent) => {
     const text = event.clipboardData?.getData("text/plain");
     if (text) { event.preventDefault(); sendClipboardText(text); }
    };
    surface.addEventListener("paste", paste as EventListener);
    sendCtrlAltDel.current = () => {
     if (!client) return;
     client.sendKeyEvent(1, KEYSYM_CTRL);
     client.sendKeyEvent(1, KEYSYM_ALT);
     client.sendKeyEvent(1, KEYSYM_DELETE);
     client.sendKeyEvent(0, KEYSYM_DELETE);
     client.sendKeyEvent(0, KEYSYM_ALT);
     client.sendKeyEvent(0, KEYSYM_CTRL);
    };
    const focus = () => surface.focus({ preventScroll: true });
    const reset = () => { keyboard.reset(); mouse.reset(); };
    surface.addEventListener("mousedown", focus);
    surface.addEventListener("blur", reset);
    window.addEventListener("blur", reset);
    const visibility = () => { if (document.hidden) reset(); };
    document.addEventListener("visibilitychange", visibility);
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    const fit = () => {
     if (display.getWidth() && display.getHeight()) display.scale(Math.min(1, host.clientWidth / display.getWidth(), host.clientHeight / display.getHeight()));
    };
    const applyScaleNow = () => {
     if (viewModeRef.current === "actual") display.scale(1);
     else fit();
    };
    const resize = () => {
     applyScaleNow();
     clearTimeout(resizeTimer);
     resizeTimer = setTimeout(() => {
      if (viewModeRef.current !== "fit") return;
      client.sendSize(Math.max(200, Math.min(4096, Math.floor(host.clientWidth))), Math.max(200, Math.min(4096, Math.floor(host.clientHeight))));
     }, 150);
    };
    applyScale.current = applyScaleNow;
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    display.onresize = applyScaleNow;
    release = () => {
     reset();
     keyboard.onkeydown = keyboard.onkeyup = null;
     mouse.offEach(mouseEvents, sendMouse);
     surface.removeEventListener("paste", paste as EventListener);
     surface.removeEventListener("mousedown", focus);
     surface.removeEventListener("blur", reset);
     window.removeEventListener("blur", reset);
     document.removeEventListener("visibilitychange", visibility);
     observer.disconnect(); clearTimeout(resizeTimer);
     client.onerror = client.onstatechange = client.onclipboard = null;
     display.onresize = null;
     client.disconnect();
    };
    const drop = () => {
     if (disposed || dropped) return;
     dropped = true;
     release();
     host.replaceChildren();
     // Only an established session auto-reconnects — a failed first
     // connect must leave its error message on screen, not loop.
     if (everConnected && !userStopped && reconnects < MAX_RECONNECT_ATTEMPTS) {
      reconnects += 1;
      setReconnectAttempt(reconnects);
      setStatus("rdp.status.reconnecting");
      reconnectTimer = setTimeout(() => { dropped = false; void connect(); }, Math.min(3_000 * 2 ** (reconnects - 1), 60_000));
      return;
     }
     setStatus("rdp.status.disconnected");
     if (!userStopped && everConnected) setError(previous => previous ?? "rdp.error.connection");
    };
    const failed = () => {
     if (disposed) return;
     if (everConnected) drop();
     else { setError("rdp.error.connection"); setStatus("rdp.status.disconnected"); cleanup(); }
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
     if (state === 3) { setStatus("rdp.status.connected"); setError(null); reconnects = 0; setReconnectAttempt(0); resize(); focus(); }
     if (state === 5) drop();
    };
    client.connect(ticket.token);
   } catch {
    if (!disposed) {
     setError(previous => previous ?? "rdp.error.connection");
     setStatus("rdp.status.disconnected"); cleanup();
    }
   }
  };
  void connect();
  return cleanup;
 }, [attempt, serverId]);

 // The view mode never reconnects; the live session just rescales.
 useEffect(() => {
  viewModeRef.current = viewMode;
  if (container.current) container.current.style.overflow = viewMode === "actual" ? "auto" : "hidden";
  applyScale.current();
 }, [viewMode]);

 useEffect(() => {
  const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
  document.addEventListener("fullscreenchange", onChange);
  return () => document.removeEventListener("fullscreenchange", onChange);
 }, []);

 useEffect(() => {
  if (!connected) return;
  const openedAt = Date.now();
  const timer = setInterval(() => setConnectedFor(Math.floor((Date.now() - openedAt) / 1000)), 1000);
  return () => { clearInterval(timer); setConnectedFor(0); };
 }, [connected]);

 const toggleFullscreen = () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void container.current?.requestFullscreen().catch(() => {});
 };

 const statusTone: StatusTone = connected ? "success"
  : status === "rdp.status.connecting" || status === "rdp.status.reconnecting" ? "warning" : "neutral";

 return <section className="space-y-3">
  <div className="flex flex-wrap items-center gap-3">
   <ActionButton disabled={active} onClick={() => { setError(null); setStatus("rdp.status.connecting"); setAttempt(value => value + 1); }}>{t("rdp.connect")}</ActionButton>
   <ActionButton variant="danger" disabled={!active} onClick={() => stop.current()}>{t("rdp.disconnect")}</ActionButton>
   <ActionButton variant="secondary" disabled={!connected} onClick={() => sendCtrlAltDel.current()}>Ctrl+Alt+Del</ActionButton>
   <ActionButton variant="secondary" disabled={!connected} onClick={() => setViewMode(mode => mode === "fit" ? "actual" : "fit")}>
    {t(viewMode === "fit" ? "rdp.view.actual" : "rdp.view.fit")}
   </ActionButton>
   <ActionButton variant="secondary" disabled={!connected} onClick={toggleFullscreen}>
    {t(fullscreen ? "rdp.fullscreen.exit" : "rdp.fullscreen")}
   </ActionButton>
   <StatusBadge tone={statusTone} size="md" role="status" aria-live="polite">
    {status === "rdp.status.reconnecting" ? t(status, { attempt: reconnectAttempt }) : t(status)}
   </StatusBadge>
   {connected && <span className="text-xs font-medium tabular-nums text-[var(--text-muted)]">{t("rdp.elapsed", { time: formatElapsed(connectedFor) })}</span>}
  </div>
  <p className="text-sm text-[var(--text-muted)]">{t("rdp.help")}</p>
  {error && <Notice tone="danger">{t(error)}</Notice>}
  <div ref={container} aria-label={t("rdp.display")} className="h-[65vh] min-h-64 w-full overflow-hidden rounded-lg border border-[var(--border)] bg-black" />
 </section>;
}
