import { rdpCertificateOptions } from "./certificate";
import { createConnection } from "node:net";
import type { Server as HttpServer, IncomingMessage } from "node:http";
import { StringDecoder } from "node:string_decoder";
import { WebSocketServer, WebSocket } from "ws";
import { getSessionCookieName, verifySessionToken } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { auditUserAction } from "@/lib/audit/service";
import { decrypt } from "@/lib/crypto/service";
import { checkGuacd, consumeRdpTicket, getRdpServer, guacdPort, rdpEndpointHash, rdpOriginAllowed } from "./tickets";
import { GuacParser, instruction, validateClientInstruction } from "./protocol";
import { getRdpSessionRuntimeConfig } from "@/lib/runtime-settings/service";
import { rdpAudioEnabled, rdpClipboardEnabled, rdpImageMimetypes, RDP_AUDIO_MIMETYPES } from "./features";
import { createLogger } from "@/lib/logging";

const logger = createLogger("rdp-ws");

function cookie(req: IncomingMessage) {
 const raw = req.headers.cookie?.split(";").map(v => v.trim()).find(v => v.startsWith(`${getSessionCookieName()}=`));
 try { return raw ? decodeURIComponent(raw.slice(raw.indexOf("=") + 1)) : ""; } catch { return ""; }
}
/**
 * A healthy browser tunnels a ping every 5 seconds, so ANY policy setting of
 * "never idle" must still not outlive a crashed browser on a half-open TCP
 * connection. This floor is independent of the configurable idle timeout.
 */
const DEAD_TRANSPORT_MS = 10 * 60_000;
/**
 * WebSocket-level heartbeat. The browser answers pings in its network stack,
 * and they pass Caddy and Cloudflare. When the browser's path dies without a
 * close — a network or proxy switch behind Cloudflare, which keeps the origin
 * connection open — the session stays counted until the 10 minute floor
 * above; a browser silent this long (no pong, nothing sent) gives its slot up
 * to a new desktop once the user's cap is reached (see `liveSessions`).
 *
 * Silence alone does not end a session: a browser that stops reading for a
 * while looks the same from here. Chrome freezes a background tab that keeps
 * using CPU (a desktop decoding frames), and a page that cannot keep up stops
 * reading its busiest stream first — each WebSocket is flow-controlled on its
 * own. Ending those after 60 s without a pong cut the busiest of two desktops
 * every 6–8 minutes in production (10-26), while the other kept answering.
 */
const PING_INTERVAL_MS = 15_000;
const PONG_TOLERANCE_MS = 60_000;

/**
 * Bytes queued to the browser before guacd's output is held back, and the
 * level at which it flows again. Everything queued here plays out before the
 * browser sees the result of a click: 4 MB used to sit in front of it (10 s
 * and more on a few-Mbit path through Cloudflare), and a held stream resumed
 * only on the 5-second housekeeping tick.
 */
const RDP_PAUSE_BYTES = 1_000_000;
const RDP_RESUME_BYTES = 256_000;
const RDP_RESUME_POLL_MS = 100;
/** One WebSocket message carries at most this much of a guacd chunk. */
const RDP_BATCH_BYTES = 256_000;
/**
 * guacd ends every frame with "sync", and the browser answers with the same
 * timestamp once it has drawn the frame. guacd paces itself only by how much
 * that answer's delay grows from one frame to the next, so a queue building
 * up past this process — the kernel's socket buffers, Caddy and Cloudflare,
 * several MB together, where the byte limit above cannot see it — read to it
 * as a longer path, and the desktop fell further and further behind the
 * mouse. A frame still undrawn this long after it left holds guacd back
 * until no frame older than the resume level waits.
 */
const RDP_FRAME_LAG_PAUSE_MS = 1_500;
const RDP_FRAME_LAG_RESUME_MS = 500;
/** A frame unanswered this long is not waited for any more. */
const RDP_FRAME_ANSWER_GIVE_UP_MS = 30_000;
/**
 * Concurrent RDP sessions per user (a reconnect to the same server replaces
 * its old one). Three, so an operator can keep three Windows desktops open.
 */
const MAX_RDP_SESSIONS_PER_USER = 3;
/** Guacamole status for "too many sessions for this user" (CLIENT_TOO_MANY). */
const RDP_STATUS_TOO_MANY = "797";
/** Guacamole status for a session taken over by another connection; the browser does not retry it. */
const RDP_STATUS_TAKEN_OVER = "521";
/** Bounds clipboard sync abuse: ~256 base64 chunks per clipboard transfer. */
const MAX_CLIPBOARD_BLOBS = 256;
/** Concurrently open client→guacd clipboard streams; the protocol uses one. */
const MAX_CLIPBOARD_STREAMS = 16;
/** Concurrent authenticated RDP sessions per process. */
const MAX_RDP_SESSIONS = 20;
/**
 * Credential-less sockets must not be able to squat the session cap: the
 * upgrade gate only keeps a generous headroom for in-flight handshakes, the
 * real MAX_RDP_SESSIONS cap is enforced at authentication, and a socket that
 * never presents a ticket is dropped after this window (well under the 30s
 * ticket TTL — a healthy browser connects immediately after minting).
 */
const PRE_AUTH_WINDOW_MS = 10_000;
const AUTHORIZATION_TIMEOUT_MS = 5_000;
/** Shares the existing loopback SSH service, but never its protocol or credentials. */
/** Guacamole status codes guacd reports when Windows refuses the account. */
const RDP_STATUS_UNAUTHORIZED = "769";
const RDP_STATUS_FORBIDDEN = "771";
/**
 * Statuses for a session Windows itself ended: signed out or disconnected
 * from inside Windows (0), taken over by another connection to the same
 * account (521), the idle limit (522), or ended by an administrator or the
 * session time limit (523). The browser shows why and does not reconnect:
 * reconnecting would log the account back in, or take the session back from
 * whoever has it now — who would take it back again.
 */
const RDP_SESSION_ENDED = new Set(["0", "521", "522", "523"]);
/** How long guacd gets to close its side after the disconnect instruction. */
const TUNNEL_CLOSE_GRACE_MS = 2_000;
/**
 * Malformed browser instructions are dropped, not fatal: one bad mouse
 * position (switching tabs, resizing the window) used to end the whole
 * desktop session. A browser sending this many a minute is not a desktop in use.
 */
const MAX_DROPPED_PER_MINUTE = 50;

/**
 * A mouse position the browser computed as negative or fractional — an
 * off-pixel centred desktop gives -1 at its edge — is clamped onto the desktop.
 */
function normalizeMouse(row: string[]): string[] | null {
 if (row[0] !== "mouse" || row.length !== 4) return null;
 const [x, y, mask] = row.slice(1).map(Number);
 if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(mask) || mask! < 0 || mask! > 31) return null;
 const clamp = (n: number) => String(Math.min(8192, Math.max(0, Math.floor(n))));
 return ["mouse", clamp(x!), clamp(y!), String(mask)];
}

/** The desktop size a session starts at when the browser does not say. */
const DEFAULT_DESKTOP = { width: 1280, height: 800 };

/**
 * The size the browser's desktop area has, from the WebSocket URL
 * (`/rdp?width=…&height=…`; not a secret, unlike the ticket). Starting the
 * session at that size matters: guacd overwrites a resize request that
 * arrives before Windows' display channel is up with the current size, so the
 * old fixed 1280×800 start often stayed — a desktop smaller than the window,
 * with black bands right and below. Every resize is also a chance for guacd
 * 1.6.0 with FreeRDP 2 to abort the session (GUAC_ASSERT in
 * guac_rdp_gdi_desktop_resize) when it lands mid-paint. guacd rounds the
 * starting width down to a multiple of 4 (and later resize requests to an even
 * width): asking for such a width keeps the browser's later requests equal to
 * it, so they resize nothing.
 */
export function initialDesktopSize(url: string | undefined): { width: number; height: number } {
 let params: URLSearchParams;
 try { params = new URL(url ?? "/", "http://localhost").searchParams; } catch { return DEFAULT_DESKTOP; }
 const width = Number(params.get("width")), height = Number(params.get("height"));
 const valid = (n: number) => Number.isInteger(n) && n >= 200 && n <= 4096;
 if (!valid(width) || !valid(height)) return DEFAULT_DESKTOP;
 return { width: width - (width % 4), height };
}

/** What a dropped instruction looked like, for the log: its numbers, not what was typed. */
function describeInstruction(row: string[]) {
 const [op = "", ...args] = row;
 return { op: op.slice(0, 32), args: op === "key" ? args.map(() => "<keysym>") : args.slice(0, 6).map((v) => (/^-?[\d.e+]{1,24}$/i.test(v) || v === "NaN" || v === "Infinity" || v === "-Infinity" ? v : `<${v.length} chars>`)) };
}

export function setupRdpWebSocket(server: HttpServer) {
 const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384, perMessageDeflate: false,
  handleProtocols: protocols => protocols.has("guacamole") ? "guacamole" : false });
 const users = new Map<string, number>();
 let authedSessions = 0;
 /**
  * The live session of each user on each server. A new connection of the
  * same user to the same server replaces it: that is a reconnect after the
  * old browser connection died unseen (the workbench opens one desktop per
  * server), or a second window — which Windows would take the account's
  * session over for anyway. A desktop on another server, once the user's cap
  * is reached, takes the place of the session whose browser has been silent
  * longest, if one has been silent past PONG_TOLERANCE_MS.
  */
 const liveSessions = new Map<string, { userId: string; silentMs: () => number; supersede: (reason?: string) => void }>();
 server.on("upgrade", (req, socket, head) => {
  let path: string;
  try { path = new URL(req.url ?? "/", "http://localhost").pathname; } catch { socket.destroy(); return; }
  if (path !== "/rdp") return;
  if (!req.headers["sec-websocket-protocol"]?.split(",").some(v => v.trim() === "guacamole")) { socket.destroy(); return; }
  // Headroom backstop only (MAX_RDP_SESSIONS authed sessions + handshakes in
  // flight); the session cap itself is enforced once the ticket is claimed.
  if (process.env.RDP_ENABLED !== "true" || !rdpOriginAllowed(req.headers.origin ?? "") || wss.clients.size >= MAX_RDP_SESSIONS * 3) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => { wss.emit("connection", ws, req); });
 });
 wss.on("connection", (ws, req) => {
  let tunnel: ReturnType<typeof createConnection> | undefined;
  const desktop = initialDesktopSize(req.url);
  let lastPongAt = Date.now();
  let lastPingAt = Date.now();
  ws.on("pong", () => { lastPongAt = Date.now(); });
  // Set while this connection holds one of the user's session slots.
  let slotKey: string | undefined;
  let userId: string | undefined;
  let serverId: string | undefined;
  let teamId: string | null = null;
  let authenticated = false;
  let stopped = false;
  let revalidate: (() => Promise<void>) | undefined;
  let validating = false;
  let authorizationDeadline = 0;
  let started = false;
  let tunnelPaused = false;
  let resumePoll: ReturnType<typeof setInterval> | undefined;
  // Frames sent to the browser and not yet answered as drawn, oldest first,
  // and the latest timestamp it answered: it answers each timestamp once, so
  // a frame guacd ends with an answered timestamp is never waited for.
  const undrawn: { timestamp: number; sentAt: number }[] = [];
  let drawnUpTo = -Infinity;
  const frameLagMs = () => {
   const now = Date.now();
   while (undrawn.length && now - undrawn[0]!.sentAt > RDP_FRAME_ANSWER_GIVE_UP_MS) undrawn.shift();
   return undrawn.length ? now - undrawn[0]!.sentAt : 0;
  };
  const holdBack = (paused: boolean) => ws.readyState === WebSocket.OPEN &&
   (ws.bufferedAmount > (paused ? RDP_RESUME_BYTES : RDP_PAUSE_BYTES) || frameLagMs() > (paused ? RDP_FRAME_LAG_RESUME_MS : RDP_FRAME_LAG_PAUSE_MS));
  const resumeIfCaughtUp = () => {
   if (!tunnelPaused || holdBack(true)) return;
   clearInterval(resumePoll); resumePoll = undefined;
   tunnelPaused = false; tunnel?.resume();
  };
  // Instructions of one guacd chunk, sent as one WebSocket message: one
  // message per instruction (thousands a second while the screen changes)
  // cost a frame header and Cloudflare's per-message handling each.
  let outbox: string[] = [];
  let outboxBytes = 0;
  const flushOutbox = () => {
   if (!outbox.length) return;
   const payload = outbox.join("");
   outbox = []; outboxBytes = 0;
   if (ws.readyState === WebSocket.OPEN) ws.send(payload);
   if (!tunnelPaused && holdBack(false)) {
    // A slow browser holds guacd back instead of queueing seconds of frames;
    // guacd then paces itself and Windows sends fewer, newer updates.
    tunnelPaused = true; tunnel?.pause();
    resumePoll = setInterval(resumeIfCaughtUp, RDP_RESUME_POLL_MS);
   }
  };
  let lastInput = Date.now();
  const openedAt = Date.now();
  // Session policy (runtime.sshIdleTimeoutSec-style settings, 0 = unlimited)
  // plus channel feature flags, resolved per connection at authentication.
  let idleTimeoutMs = 0;
  let maxSessionMs = 0;
  let clipboardAllowed = false;
  let audioAllowed = false;
  let imageMimetypes = ["image/png", "image/jpeg"];
  const clipboardStreams = new Map<number, number>();
  // One "failed" per attempt: guacd's error already recorded why, so the
  // close that follows a failed handshake must not record it a second time.
  let failureAudited = false;
  // Why the session ended, for the "closed" audit: the gateway's own reason,
  // guacd's, or the browser leaving (with its WebSocket close code: 1006 is
  // a connection lost without a goodbye).
  let endedBy: string | undefined;
  let tunnelEnding = false;
  const audit = (event: string, detail: Record<string, string> = {}) => {
   if (userId && serverId) void auditUserAction(userId, event, { serverId, ...detail }, undefined, teamId).catch(() => {});
  };
  // Gives the session slot back once: when the browser goes, or at once when
  // a new connection replaces this one (its close handshake with a dead
  // browser can take another 30 s).
  const releaseSlot = () => {
   if (!userId || !authenticated || slotKey === undefined) return;
   if (liveSessions.get(slotKey)?.supersede === supersede) liveSessions.delete(slotKey);
   slotKey = undefined;
   authedSessions--;
   const count = (users.get(userId) ?? 1) - 1;
   if (count) users.set(userId, count); else users.delete(userId);
  };
  function supersede(reason = "RDP session taken over by a new connection") {
   releaseSlot();
   // Status 521 (taken over): a browser still showing this session explains
   // it and does not reconnect — two windows would otherwise keep taking the
   // desktop from each other.
   close(reason, 1000, RDP_STATUS_TAKEN_OVER);
  }
  // Since the browser last answered a ping or sent anything.
  const silentMs = () => Date.now() - Math.max(lastPongAt, lastInput);
  // guacd sits behind the rootless Docker port proxy, which does not always
  // pass a closed socket on: guacd then kept the RDP connection logged in to
  // Windows until its own 15 s input timeout. A reconnect inside that window
  // had to take the session over from the leftover connection: the sign-in
  // screen showed "Other user", and the leftover was kicked off ("Disconnected
  // by other connection"). Tell guacd the user is leaving, then close.
  const endTunnel = () => {
   const socket = tunnel;
   if (!socket || socket.destroyed || tunnelEnding) return;
   tunnelEnding = true;
   if (socket.connecting || !socket.writable) { socket.destroy(); return; }
   socket.end(instruction("disconnect"));
   setTimeout(() => socket.destroy(), TUNNEL_CLOSE_GRACE_MS).unref?.();
  };
  const close = (reason: string, code = 1011, status = "512") => {
   stopped = true;
   endedBy ??= `gateway: ${reason}`;
   flushOutbox();
   clearInterval(resumePoll);
   if (ws.readyState === WebSocket.OPEN) { ws.send(instruction("error", reason, status)); ws.close(code); }
   endTunnel();
  };
  const handshakeTimeout = setTimeout(() => close("RDP handshake timed out"), 30_000);
  const timer = setInterval(() => {
   if (stopped) return;
   if (!authenticated && Date.now() - openedAt > PRE_AUTH_WINDOW_MS) { close("RDP authentication timed out", 1008); return; }
   // A stalled database query must not suspend revocation checks forever.
   // This watchdog runs independently of the pending authorization promise.
   if (validating && Date.now() >= authorizationDeadline) { close("RDP session authorization expired", 1008); return; }
   if (revalidate && !validating) {
    validating = true;
    authorizationDeadline = Date.now() + AUTHORIZATION_TIMEOUT_MS;
    void revalidate().catch(() => close("RDP session authorization expired", 1008)).finally(() => { validating = false; });
   }
   // The dead-transport floor always applies; the idle/absolute caps are the
   // admin-configured session policy and default to "as long as the browser".
   if (Date.now() - lastInput > DEAD_TRANSPORT_MS ||
    (idleTimeoutMs > 0 && Date.now() - lastInput > idleTimeoutMs) ||
    (maxSessionMs > 0 && Date.now() - openedAt > maxSessionMs)) { close("RDP session limit reached", 1000); return; }
   if (Date.now() - lastPingAt >= PING_INTERVAL_MS && ws.readyState === WebSocket.OPEN) { lastPingAt = Date.now(); ws.ping(); }
   if (started) {
    // guacd drops clients that stay silent for ~20s, and background tabs get
    // their JS timers throttled, so the browser cannot always keep the
    // protocol alive alone: nop to guacd on its behalf, and ping the browser
    // so a live but idle desktop never trips its receive timeout.
    tunnel?.write(instruction("nop"));
    if (ws.readyState === WebSocket.OPEN) ws.send(instruction("", "ping", String(Date.now())));
   }
   if (ws.bufferedAmount > 64_000_000) close("RDP backpressure limit reached");
  }, 5000);
  ws.on("error", () => { endTunnel(); });
  ws.on("close", (code: number) => {
   stopped = true;
   endedBy ??= `browser: ${code}`;
   clearTimeout(handshakeTimeout); clearInterval(timer); clearInterval(resumePoll); endTunnel();
   releaseSlot();
   if (started) audit("server.rdp.closed", { reason: endedBy.slice(0, 120), seconds: String(Math.round((Date.now() - openedAt) / 1000)) });
   else if (!failureAudited) audit("server.rdp.failed");
  });
  let dropped = 0, droppedSince = 0, droppedTotal = 0;
  const input = new GuacParser(parsed => {
   if (stopped) return;
   if (!started) { close("Unsupported RDP input before the session started", 1008); return; }
   let row = parsed;
   if (!validateClientInstruction(row, { clipboard: clipboardAllowed })) {
    const mouse = normalizeMouse(row);
    if (mouse) row = mouse;
    else {
     // Never forwarded, so guacd stays safe; the session goes on.
     const now = Date.now();
     if (now - droppedSince > 60_000) { droppedSince = now; dropped = 0; }
     dropped += 1;
     droppedTotal += 1;
     if (droppedTotal <= 5) logger.warn("dropped an invalid RDP instruction from the browser", { serverId, ...describeInstruction(parsed) });
     if (dropped > MAX_DROPPED_PER_MINUTE) close(`Unsupported RDP input (${(parsed[0] ?? "").slice(0, 32)})`, 1008);
     return;
    }
   }
   // Any validated traffic — keep-alive nops and ping echoes included — proves
   // the browser is still there and resets the idle limit.
   lastInput = Date.now();
   if (row[0] === "sync") {
    const timestamp = Number(row[1]);
    if (timestamp > drawnUpTo) drawnUpTo = timestamp;
    while (undrawn.length && undrawn[0]!.timestamp <= drawnUpTo) undrawn.shift();
    resumeIfCaughtUp();
   }
   if (row[0] === "") { if (ws.readyState === WebSocket.OPEN) ws.send(instruction(...row)); return; }
   if (row[0] === "disconnect") { endedBy ??= "browser: disconnect"; ws.close(1000); endTunnel(); return; }
   // Clipboard is the only client-created stream type; blobs and end must
   // stay on an index a clipboard instruction allocated this session.
   if (clipboardAllowed && (row[0] === "clipboard" || row[0] === "blob" || row[0] === "end")) {
    const index = Number(row[1]);
    if (row[0] === "clipboard") {
     // A client may only keep a handful of clipboard streams open at once;
     // without the cap each instruction could allocate an arbitrary index and
     // grow the set (and guacd state) without bound.
     if (clipboardStreams.has(index) || clipboardStreams.size >= MAX_CLIPBOARD_STREAMS) { close("RDP clipboard limit reached", 1008); return; }
     clipboardStreams.set(index, 0);
    }
    else if (!clipboardStreams.has(index)) { close(`Unsupported RDP input (${row[0]} on an unknown stream)`, 1008); return; }
    if (row[0] === "blob") {
     const blobs = clipboardStreams.get(index)! + 1;
     if (blobs > MAX_CLIPBOARD_BLOBS) { close("RDP clipboard limit reached", 1008); return; }
     clipboardStreams.set(index, blobs);
    }
    if (row[0] === "end") clipboardStreams.delete(index);
   }
   if ((tunnel?.writableLength ?? 0) > 16_000_000) { close("RDP backpressure limit reached"); return; }
   // nop MUST reach guacd: swallowing it is what made guacd log "User is not
   // responding" and kill idle desktops ~20 seconds in.
   tunnel?.write(instruction(...row));
  }, 16_384);
  let claiming = false;
  ws.on("message", async (raw, binary) => {
   if (stopped) return;
   if (binary) { close("Text protocol required", 1008); return; }
   if (authenticated) { try { input.feed(raw.toString()); } catch { close("Invalid RDP input", 1008); } return; }
   if (claiming) { close("Authentication pending", 1008); return; }
   claiming = true;
   let tooMany = false;
   try {
    // Ticket travels in first WS frame, never URLs / access logs.
    const token = raw.toString();
    const sessionCookie = cookie(req);
    const session = await verifySessionToken(sessionCookie);
    if (session.mustChangePassword || !sessionHasPermission(session, "server:ssh")) throw new Error("Denied");
    // The per-user cap is checked once the ticket names the server: a
    // reconnect to the same server replaces its old session instead.
    const target = await consumeRdpTicket(token, session, sessionCookie, req.headers.origin ?? "");
    await checkGuacd();
    const { idleTimeoutMs: idleMs, maxSessionMs: maxMs } = await getRdpSessionRuntimeConfig();
    idleTimeoutMs = idleMs; maxSessionMs = maxMs;
    clipboardAllowed = rdpClipboardEnabled(); audioAllowed = rdpAudioEnabled(); imageMimetypes = await rdpImageMimetypes();
    if (stopped || ws.readyState !== WebSocket.OPEN) return;
    const endpointHash = rdpEndpointHash(target);
    revalidate = async () => {
     const current = await verifySessionToken(sessionCookie);
     if (current.mustChangePassword || !sessionHasPermission(current, "server:ssh") || current.userId !== session.userId || current.currentTeamId !== session.currentTeamId) throw new Error("Denied");
     if (rdpEndpointHash(await getRdpServer(target.id, current)) !== endpointHash) throw new Error("Changed");
    };
    // After async authentication, so the process-local caps stay atomic.
    const key = `${session.userId}:${target.id}`;
    liveSessions.get(key)?.supersede();
    if ((users.get(session.userId) ?? 0) >= MAX_RDP_SESSIONS_PER_USER) {
     const silent = [...liveSessions.values()].filter((live) => live.userId === session.userId && live.silentMs() > PONG_TOLERANCE_MS);
     silent.sort((a, b) => b.silentMs() - a.silentMs())[0]?.supersede("RDP session given up for a new desktop: its browser had stopped answering");
    }
    if ((users.get(session.userId) ?? 0) >= MAX_RDP_SESSIONS_PER_USER) { tooMany = true; throw new Error("Too many sessions"); }
    if (authedSessions >= MAX_RDP_SESSIONS) throw new Error("Denied");
    userId = session.userId; serverId = target.id; teamId = target.teamId;
    users.set(userId, (users.get(userId) ?? 0) + 1); authedSessions++; authenticated = true;
    slotKey = key; liveSessions.set(key, { userId, silentMs, supersede });
    audit("server.rdp.connecting");
    let phase: "args" | "ready" | "stream" = "args";
    const options: Record<string, string> = {
     hostname: target.host, port: String(target.port), username: target.username,
     password: decrypt(target.rdpPassword!), domain: target.rdpDomain ?? "",
     security: "nla", ...rdpCertificateOptions(target),
     ...(clipboardAllowed ? {} : { "disable-copy": "true", "disable-paste": "true" }),
     "enable-drive": "false",
     "enable-printing": "false", "enable-audio-input": "false",
     ...(audioAllowed ? {} : { "disable-audio": "true" }),
     "resize-method": "display-update", "server-layout": "en-us-qwerty",
     // With the graphics pipeline (GFX), FreeRDP 2 applies a resize from the
     // GFX channel's thread while a frame may be mid-paint, and guacd 1.6.0
     // aborts the whole session on that (GUAC_ASSERT in
     // guac_rdp_gdi_desktop_resize; five times in production 10-20..10-26,
     // each when a desktop was resized). Without it Windows resizes through
     // deactivate/reactivate on guacd's main thread, in order with painting.
     // guacd's colour depth without GFX defaults to 16 bits: ask for 24.
     "disable-gfx": "true", "color-depth": "24",
     "enable-wallpaper": "false", "enable-theming": "false",
    };
    const decoder = new StringDecoder("utf8");
    tunnel = createConnection({ host: "127.0.0.1", port: guacdPort() });
    tunnel.once("connect", () => { if (!tunnelEnding) tunnel?.write(instruction("select", "rdp")); });
    tunnel.on("error", () => close("RDP gateway connection failed"));
    tunnel.on("close", () => { endedBy ??= "guacd closed the connection"; if (ws.readyState === WebSocket.OPEN) ws.close(1000); });
    const output = new GuacParser(row => {
     if (stopped) return;
     if (row[0] === "error") {
      // Keep why: the audit held only the server, so a run of failed logins
      // could not be told from a refused account (769), a locked one (771)
      // or an unreachable host without guacd's own log.
      failureAudited = true;
      endedBy ??= `guacd: ${row[2] ?? ""} ${(row[1] ?? "").slice(0, 80)}`;
      audit("server.rdp.failed", { status: row[2] ?? "", message: (row[1] ?? "").slice(0, 200) });
      // Windows refusing the login arrives after "ready". Keep guacd's
      // status for it: the browser must tell a wrong account or password
      // (769) and a locked, disabled or expired account (771) from a dropped
      // connection, and must not retry a login Windows rejected — repeated
      // attempts count towards the account lockout.
      const status = row[2] ?? "";
      if (status === RDP_STATUS_UNAUTHORIZED || status === RDP_STATUS_FORBIDDEN) { close("Windows refused the login", 1000, status); return; }
      if (RDP_SESSION_ENDED.has(status)) { close("Windows ended the session", 1000, status); return; }
      close("Windows RDP connection failed (check credentials, NLA and certificate)"); return;
     }
     if (phase === "args") {
      if (row[0] !== "args") throw new Error("Expected args");
      const args = row.slice(1);
      rdpCertificateOptions(target, args);
      tunnel?.write(instruction("size", String(desktop.width), String(desktop.height), "96") + instruction("audio", ...(audioAllowed ? RDP_AUDIO_MIMETYPES : [])) + instruction("video") + instruction("image", ...imageMimetypes) +
       instruction("connect", ...args.map(key => key.startsWith("VERSION_") ? "VERSION_1_5_0" : options[key] ?? "")));
      delete options.password;
      phase = "ready"; return;
     }
     if (phase === "ready") {
      if (row[0] !== "ready") throw new Error("Expected ready");
      phase = "stream"; started = true; clearTimeout(handshakeTimeout);
      audit("server.rdp.connected");
      // Internal Guacamole tunnel UUID handshake.
      ws.send(instruction("", row[1] ?? "")); return;
     }
     // Clipboard and audio streams pass through only when the deployment
     // opted in; blobs/acks of allowed streams are forwarded below.
     const op = row[0] ?? "";
     const allowed = (op === "clipboard" && clipboardAllowed) || (op === "audio" && audioAllowed);
     if (["clipboard", "file", "pipe", "filesystem", "audio", "video"].includes(op) && !allowed) { close("Unsupported RDP stream", 1008); return; }
     if (ws.bufferedAmount > 64_000_000) { close("RDP backpressure limit reached"); return; }
     if (op === "sync") {
      const timestamp = Number(row[1]);
      if (timestamp > drawnUpTo) { undrawn.push({ timestamp, sentAt: Date.now() }); if (undrawn.length > 1_000) undrawn.shift(); }
     }
     const text = instruction(...row);
     outbox.push(text); outboxBytes += text.length;
     if (outboxBytes >= RDP_BATCH_BYTES) flushOutbox();
    });
    tunnel.on("data", data => {
     try { output.feed(decoder.write(data)); } catch { close("Invalid RDP gateway response"); return; }
     flushOutbox();
    });
   } catch {
    // The browser tells the user why and does not retry the cap.
    if (tooMany) close("Too many RDP sessions for this user", 1008, RDP_STATUS_TOO_MANY);
    else close("RDP authorization or gateway unavailable", 1008);
   }
  });
 });
 return () => { for (const ws of wss.clients) ws.terminate(); wss.close(); };
}
