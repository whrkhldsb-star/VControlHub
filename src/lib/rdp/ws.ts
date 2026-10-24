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
import { rdpAudioEnabled, rdpClipboardEnabled, RDP_AUDIO_MIMETYPES } from "./features";
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
  let lastInput = Date.now();
  const openedAt = Date.now();
  // Session policy (runtime.sshIdleTimeoutSec-style settings, 0 = unlimited)
  // plus channel feature flags, resolved per connection at authentication.
  let idleTimeoutMs = 0;
  let maxSessionMs = 0;
  let clipboardAllowed = false;
  let audioAllowed = false;
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
   if (started) {
    // guacd drops clients that stay silent for ~20s, and background tabs get
    // their JS timers throttled, so the browser cannot always keep the
    // protocol alive alone: nop to guacd on its behalf, and ping the browser
    // so a live but idle desktop never trips its receive timeout.
    tunnel?.write(instruction("nop"));
    if (ws.readyState === WebSocket.OPEN) ws.send(instruction("", "ping", String(Date.now())));
   }
   if (tunnelPaused && ws.bufferedAmount < 1_000_000) { tunnelPaused = false; tunnel?.resume(); }
   if (ws.bufferedAmount > 64_000_000) close("RDP backpressure limit reached");
  }, 5000);
  ws.on("error", () => { endTunnel(); });
  ws.on("close", (code: number) => {
   stopped = true;
   endedBy ??= `browser: ${code}`;
   clearTimeout(handshakeTimeout); clearInterval(timer); endTunnel();
   if (userId && authenticated) { authedSessions--; const count = (users.get(userId) ?? 1) - 1; if (count) users.set(userId, count); else users.delete(userId); }
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
   try {
    // Ticket travels in first WS frame, never URLs / access logs.
    const token = raw.toString();
    const sessionCookie = cookie(req);
    const session = await verifySessionToken(sessionCookie);
    if (session.mustChangePassword || !sessionHasPermission(session, "server:ssh") || (users.get(session.userId) ?? 0) >= 2) throw new Error("Denied");
    const target = await consumeRdpTicket(token, session, sessionCookie, req.headers.origin ?? "");
    await checkGuacd();
    const { idleTimeoutMs: idleMs, maxSessionMs: maxMs } = await getRdpSessionRuntimeConfig();
    idleTimeoutMs = idleMs; maxSessionMs = maxMs;
    clipboardAllowed = rdpClipboardEnabled(); audioAllowed = rdpAudioEnabled();
    if (stopped || ws.readyState !== WebSocket.OPEN) return;
    const endpointHash = rdpEndpointHash(target);
    revalidate = async () => {
     const current = await verifySessionToken(sessionCookie);
     if (current.mustChangePassword || !sessionHasPermission(current, "server:ssh") || current.userId !== session.userId || current.currentTeamId !== session.currentTeamId) throw new Error("Denied");
     if (rdpEndpointHash(await getRdpServer(target.id, current)) !== endpointHash) throw new Error("Changed");
    };
    // Recheck after async authentication to make the process-local caps atomic.
    if ((users.get(session.userId) ?? 0) >= 2 || authedSessions >= MAX_RDP_SESSIONS) throw new Error("Denied");
    userId = session.userId; serverId = target.id; teamId = target.teamId;
    users.set(userId, (users.get(userId) ?? 0) + 1); authedSessions++; authenticated = true;
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
      tunnel?.write(instruction("size", "1280", "800", "96") + instruction("audio", ...(audioAllowed ? RDP_AUDIO_MIMETYPES : [])) + instruction("video") + instruction("image", "image/png", "image/jpeg") +
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
     if (ws.readyState === WebSocket.OPEN) ws.send(instruction(...row));
     // A slow browser pauses guacd reads instead of losing the session; the
     // interval above resumes once the socket has drained.
     if (!tunnelPaused && ws.bufferedAmount > 4_000_000) { tunnelPaused = true; tunnel?.pause(); }
    });
    tunnel.on("data", data => { try { output.feed(decoder.write(data)); } catch { close("Invalid RDP gateway response"); } });
   } catch { close("RDP authorization or gateway unavailable", 1008); }
  });
 });
 return () => { for (const ws of wss.clients) ws.terminate(); wss.close(); };
}
