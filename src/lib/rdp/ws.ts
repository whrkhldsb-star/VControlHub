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
/** Bounds clipboard sync abuse: ~256 base64 chunks ≈ 1.5 MB of text per session. */
const MAX_CLIPBOARD_BLOBS = 256;
/** Shares the existing loopback SSH service, but never its protocol or credentials. */
export function setupRdpWebSocket(server: HttpServer) {
 const wss = new WebSocketServer({ noServer: true, maxPayload: 16_384, perMessageDeflate: false,
  handleProtocols: protocols => protocols.has("guacamole") ? "guacamole" : false });
 const users = new Map<string, number>();
 server.on("upgrade", (req, socket, head) => {
  let path: string;
  try { path = new URL(req.url ?? "/", "http://localhost").pathname; } catch { socket.destroy(); return; }
  if (path !== "/rdp") return;
  if (!req.headers["sec-websocket-protocol"]?.split(",").some(v => v.trim() === "guacamole")) { socket.destroy(); return; }
  if (process.env.RDP_ENABLED !== "true" || !rdpOriginAllowed(req.headers.origin ?? "") || wss.clients.size >= 20) { socket.destroy(); return; }
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
  const clipboardStreams = new Set<number>();
  let clipboardBlobs = 0;
  const audit = (event: string) => {
   if (userId && serverId) void auditUserAction(userId, event, { serverId }, undefined, teamId).catch(() => {});
  };
  const close = (reason: string, code = 1011) => {
   stopped = true;
   if (ws.readyState === WebSocket.OPEN) { ws.send(instruction("error", reason, "512")); ws.close(code); }
   tunnel?.destroy();
  };
  const handshakeTimeout = setTimeout(() => close("RDP handshake timed out"), 30_000);
  const timer = setInterval(() => {
   if (stopped) return;
   if (revalidate && !validating) {
    validating = true;
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
  ws.on("error", () => { tunnel?.destroy(); });
  ws.on("close", () => {
   stopped = true;
   clearTimeout(handshakeTimeout); clearInterval(timer); tunnel?.destroy();
   if (userId && authenticated) { const count = (users.get(userId) ?? 1) - 1; if (count) users.set(userId, count); else users.delete(userId); }
   audit(started ? "server.rdp.closed" : "server.rdp.failed");
  });
  const input = new GuacParser(row => {
   if (stopped) return;
   if (!started || !validateClientInstruction(row, { clipboard: clipboardAllowed })) { close("Unsupported RDP input", 1008); return; }
   // Any validated traffic — keep-alive nops and ping echoes included — proves
   // the browser is still there and resets the idle limit.
   lastInput = Date.now();
   if (row[0] === "") { if (ws.readyState === WebSocket.OPEN) ws.send(instruction(...row)); return; }
   if (row[0] === "disconnect") { ws.close(1000); tunnel?.destroy(); return; }
   // Clipboard is the only client-created stream type; blobs and end must
   // stay on an index a clipboard instruction allocated this session.
   if (clipboardAllowed && (row[0] === "clipboard" || row[0] === "blob" || row[0] === "end")) {
    const index = Number(row[1]);
    if (row[0] === "clipboard") clipboardStreams.add(index);
    else if (!clipboardStreams.has(index)) { close("Unsupported RDP input", 1008); return; }
    if (row[0] === "blob" && ++clipboardBlobs > MAX_CLIPBOARD_BLOBS) { close("RDP clipboard limit reached", 1008); return; }
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
    // Recheck after async authentication to make the process-local cap atomic.
    if ((users.get(session.userId) ?? 0) >= 2) throw new Error("Denied");
    userId = session.userId; serverId = target.id; teamId = target.teamId;
    users.set(userId, (users.get(userId) ?? 0) + 1); authenticated = true;
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
    tunnel.once("connect", () => tunnel?.write(instruction("select", "rdp")));
    tunnel.on("error", () => close("RDP gateway connection failed"));
    tunnel.on("close", () => { if (ws.readyState === WebSocket.OPEN) ws.close(1000); });
    const output = new GuacParser(row => {
     if (stopped) return;
     if (row[0] === "error") { audit("server.rdp.failed"); close("Windows RDP connection failed (check credentials, NLA and certificate)"); return; }
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
