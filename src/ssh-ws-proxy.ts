/**
 * WebSocket-to-SSH proxy server
 * Runs on port 3001 alongside the Next.js app on port 3000.
 * Clients connect with: ws://host:3001/ssh?serverId=xxx&handshake=xxx
 * Session auth uses the HttpOnly cookie; only the short-lived handshake is in the URL.
 */

import { setupRdpWebSocket } from "@/lib/rdp/ws";
import { createServer } from "http";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Client } from "ssh2";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { decryptServerPassword, decryptSshPrivateKey, decryptSshKeyPassphrase } from "@/lib/ssh/ssh-key-crypto";
import { createVerifiedSshConfig } from "@/lib/ssh/client";

import { type RoleKey } from "./lib/auth/rbac";
import { canUseSshTerminal } from "./lib/auth/ssh-access";
import { serverTeamWhere } from "./lib/auth/team-scope";
import { getSessionCookieName, verifySessionToken } from "./lib/auth/session";
import { createLogger } from "./lib/logging";
import { t } from "./lib/i18n/service-translations";
import { parseTcpPort } from "./lib/runtime/listen-port";
import { verifySshWsHandshakeToken } from "./lib/auth/ssh-ws-token";
import { getSshTerminalRuntimeConfig } from "./lib/runtime-settings/service";
import {
	getWsSnapshot,
	recordWsEvent,
	setWsActive,
} from "./lib/monitoring/runtime-metrics";

const logger = createLogger("ssh-ws-proxy");

export function loadSshWsRuntimeEnv(cwd = process.cwd()) {
	if (process.env.VCONTROLHUB_RUNTIME_ENV_LOADED === "true") {
		const required = ["DATABASE_URL", "AUTH_SESSION_SECRET", "ENCRYPTION_KEY", "SSH_WS_SECRET"];
		const missing = required.filter((key) => !process.env[key]?.trim());
		if (missing.length) throw new Error(`Injected gateway environment is incomplete: ${missing.join(", ")}`);
		return;
	}
	for (const filename of [".env.runtime", ".env.local", ".env"]) {
		const filePath = resolve(cwd, filename);
		if (!existsSync(filePath)) continue;

		for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#")) continue;
			const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(trimmed);
			if (!match) continue;
			const [, key, rawValue] = match;
			if (!key || process.env[key] !== undefined) continue;
			process.env[key] = rawValue!.trim().replace(/^['\"]|['\"]$/g, "");
		}
	}
}

loadSshWsRuntimeEnv();

// ── Config ──────────────────────────────────────────────────────────

export function resolveSshWsListenConfig(env: Partial<NodeJS.ProcessEnv> = process.env) {
	const host = env.SSH_WS_HOST?.trim() || "127.0.0.1";
	const port = parseTcpPort(env.SSH_WS_PORT, 3001, "SSH_WS_PORT");

	return { host, port };
}

const { host: HOST, port: PORT } = resolveSshWsListenConfig();

// ── SSH_WS_SECRET validation ───────────────────────────────────────

export function requireSshWsSecret(env: Partial<NodeJS.ProcessEnv> = process.env): string | undefined {
	const secret = env.SSH_WS_SECRET?.trim() || undefined;
	const nodeEnv = env.NODE_ENV?.trim() || "development";

	if (!secret) {
		if (nodeEnv === "production") {
			throw new Error("SSH_WS_SECRET must be set in production");
		}
		logger.warn(
			"⚠ SSH_WS_SECRET is not set — skipping WS secret validation (development only). " +
			"Set SSH_WS_SECRET before deploying to production.",
		);
	}

	return secret;
}

const SSH_WS_SECRET = requireSshWsSecret();

// ── Prisma (matching the main app's initialization) ─────────────────
// ── Session verification ────────────────────────────────────────────

type SessionPayload = {
  userId: string;
  username: string;
  roles: RoleKey[];
  mustChangePassword: boolean;
  currentTeamId: string | null;
};

// ── Resolve server SSH connection ───────────────────────────────────

/**
 * `team:manage` may connect to any server; others only own team + legacy null.
 * Resolved through `sessionHasPermission` so a direct per-user `team:manage`
 * grant counts here exactly as it does on the HTTP surface — the static role
 * map alone would silently deny a delegated platform manager a terminal.
 */
export async function resolveServerConnection(
  serverId: string,
  session: SessionPayload,
) {
 // Server rows are security roots: a null teamId is quarantined legacy data,
 // NOT an implicit shared VPS. This must match `serverTeamWhere()` /
 // `assertServerTeamAccess()` — the HTTP surface already restricts unassigned
 // servers to `team:manage`, so accepting them here would let any user with
 // `server:ssh` open a root shell on a legacy VPS the web UI hides from them.
 const srv = await prisma.server.findFirst({
  where: {
   id: serverId,
   ...serverTeamWhere(session, "connect"),
  },
  select: {
   id: true,
   name: true,
   host: true,
   port: true,
   username: true,
   enabled: true,
   operatingSystem: true,
   connectionType: true,
   password: true,
   hostKeySha256: true,
   teamId: true,
   sshKey: { select: { privateKey: true, passphrase: true } },
  },
 });
 if (!srv || !srv.enabled) return null;

 if (srv.operatingSystem === "WINDOWS") {
  // Windows terminals ride the OpenSSH Server captured by the cloud-storage
  // binding: the SFTP port/username/host-key live on the bound StorageNode
  // (server.port is the RDP port), and the SFTP password on the server row.
  // Without a binding there is no SSH endpoint to open a shell on.
  const sftpNode = await prisma.storageNode.findUnique({
   where: { serverId: srv.id },
   select: { port: true, username: true, hostKeySha256: true },
  });
  if (!sftpNode || !srv.password || !sftpNode.username) return null;
  return {
   host: srv.host,
   port: sftpNode.port ?? 22,
   username: sftpNode.username,
   connectionType: "PASSWORD",
   hostKeySha256: sftpNode.hostKeySha256 ?? srv.hostKeySha256,
   privateKey: undefined,
   passphrase: undefined,
   password: decryptServerPassword(srv.password ?? ""),
  };
 }

 if (srv.connectionType === "SSH_KEY" && !srv.sshKey?.privateKey) return null;
 if (srv.connectionType === "PASSWORD" && !srv.password) return null;

 return {
  host: srv.host,
  port: srv.port,
  username: srv.username,
  connectionType: srv.connectionType,
  hostKeySha256: srv.hostKeySha256,
	privateKey: srv.connectionType === "SSH_KEY" ? decryptSshPrivateKey(srv.sshKey!.privateKey ?? "") : undefined,
	passphrase: srv.connectionType === "SSH_KEY" && srv.sshKey?.passphrase ? decryptSshKeyPassphrase(srv.sshKey.passphrase) : undefined,
	password: srv.connectionType === "PASSWORD" ? decryptServerPassword(srv.password ?? "") : undefined,
 };
}

// ── Terminal SSH config ─────────────────────────────────────────────

type TerminalConnParams = Awaited<ReturnType<typeof resolveServerConnection>>;

/**
 * Build the ssh2 connect config for a terminal session.
 *
 * `enforceHostKeyPin: true` keeps the terminal channel fail-closed, matching
 * the command-execution path (service-execution refuses unpinned targets):
 * a server whose host key was never pinned is rejected during the handshake
 * instead of being silently accepted (TOFU).
 */
export function buildTerminalSshConfig(
	connParams: NonNullable<TerminalConnParams>,
	terminalRuntimeConfig: { sshKeepaliveIntervalMs: number; sshKeepaliveCountMax: number },
) {
	const sshConfig = createVerifiedSshConfig({
		host: connParams.host,
		port: connParams.port,
		username: connParams.username,
		hostKeySha256: connParams.hostKeySha256,
		enforceHostKeyPin: true,
		...(connParams.connectionType === "SSH_KEY" ? { privateKey: connParams.privateKey, ...(connParams.passphrase ? { passphrase: connParams.passphrase } : {}) } : { password: connParams.password }),
	});
	sshConfig.readyTimeout = 15000;
	sshConfig.timeout = 10000;
	sshConfig.keepaliveInterval = terminalRuntimeConfig.sshKeepaliveIntervalMs;
	sshConfig.keepaliveCountMax = terminalRuntimeConfig.sshKeepaliveCountMax;
	return sshConfig;
}

/**
 * Translate a terminal handshake failure for the browser. Host-key
 * verification failures (an unpinned or changed host key rejected by the
 * enforced pin) get an actionable message that tells the operator to pin the
 * fingerprint first; anything else keeps the raw ssh2 detail.
 */
export function describeTerminalSshError(err: Error): string {
	if (/host key verification|host verifier/i.test(err.message)) {
		return t("backend.ssh.hostKeyNotPinned");
	}
	return `SSH connection error: ${err.message}`;
}

// ── WebSocket server ────────────────────────────────────────────────

const MAX_WS_CONNECTIONS = config.ssh.wsMaxConnections;
// Legacy env fallback only: when the runtime-settings DB read fails at boot,
// the old SSH_WS_IDLE_TIMEOUT_MS behavior keeps the reaper bounded.
const LEGACY_WS_IDLE_TIMEOUT_MS = config.ssh.wsIdleTimeoutMs;
const DEFAULT_WS_HEARTBEAT_INTERVAL_MS = config.ssh.wsHeartbeatIntervalMs;
const DEFAULT_SSH_KEEPALIVE_INTERVAL_MS = config.ssh.keepaliveIntervalMs;
const DEFAULT_SSH_KEEPALIVE_COUNT_MAX = config.ssh.keepaliveCountMax;
const wsHeartbeatState = new WeakMap<WebSocket, boolean>();
let wsHeartbeatTimer: NodeJS.Timeout | null = null;
let sshWss: WebSocketServer | null = null;

async function getSshTerminalRuntimeConfigWithFallback() {
	try {
		return await getSshTerminalRuntimeConfig();
	} catch (error) {
		logger.warn("failed to load SSH terminal runtime settings; using env/default fallback", error);
		return {
			wsHeartbeatIntervalMs: DEFAULT_WS_HEARTBEAT_INTERVAL_MS,
			sshKeepaliveIntervalMs: DEFAULT_SSH_KEEPALIVE_INTERVAL_MS,
			sshKeepaliveCountMax: DEFAULT_SSH_KEEPALIVE_COUNT_MAX,
			sshIdleTimeoutMs: LEGACY_WS_IDLE_TIMEOUT_MS,
		};
	}
}

function startWsHeartbeat(intervalMs: number) {
	if (wsHeartbeatTimer) clearInterval(wsHeartbeatTimer);
	wsHeartbeatTimer = setInterval(() => {
		if (!sshWss) return;
		for (const client of sshWss.clients) {
			if (client.readyState !== WebSocket.OPEN) continue;
			if (wsHeartbeatState.get(client) === false) {
				logger.warn("terminating unresponsive SSH WebSocket client");
				client.terminate();
				continue;
			}
			wsHeartbeatState.set(client, false);
			client.ping();
		}
	}, intervalMs);
	wsHeartbeatTimer.unref();
}

/**
 * Parse only the pathname of an incoming request URL, anchored to a fixed
 * base. A malformed request-target (or a hostile `Host` header, when the
 * caller is tempted to use it as the base) must not be able to make the URL
 * constructor throw inside a request/upgrade listener: Node does not catch
 * handler exceptions, so the throw would reach the process level and kill the
 * proxy from a single unauthenticated packet. Returns null for unparseable
 * targets so callers can answer 400 and drop the socket.
 */
export function parseSshWsRequestPath(rawUrl: string | undefined): string | null {
	try {
		return new URL(rawUrl || "/", "http://localhost").pathname;
	} catch {
		return null;
	}
}

const server = createServer((req, res) => {
	const pathname = parseSshWsRequestPath(req.url);
	if (pathname === null) {
		res.writeHead(400);
		res.end();
		return;
	}
	// Local-only observability scrape endpoint for the main app.
	if (req.method === "GET" && pathname === "/metrics") {
		const active = sshWss?.clients.size ?? 0;
		setWsActive("ssh", active);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ websocket: getWsSnapshot().ssh, activeClients: active }));
		return;
	}
	res.writeHead(204);
	res.end();
});

const closeRdp = setupRdpWebSocket(server);
const SSH_AUTH_REVALIDATION_MS = 30_000;
const SSH_MAX_MESSAGE_BYTES = 64 * 1024;
const SSH_MAX_QUEUED_BYTES = 4 * 1024 * 1024;
const SSH_MAX_TOTAL_QUEUED_BYTES = 32 * 1024 * 1024;
let pendingSshInputBytes = 0;
const activeSshConnectionsByUser = new Map<string, number>();
async function withAuthorizationDeadline<T>(operation: PromiseLike<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("SSH authorization deadline exceeded")), 5_000);
    })]);
  } finally { clearTimeout(timer); }
}

const wss = new WebSocketServer({
	noServer: true,
	maxPayload: SSH_MAX_MESSAGE_BYTES,
	perMessageDeflate: false,
	verifyClient(info, callback) {
		if (!isOriginAllowed(info.req)) {
			recordWsEvent("ssh", "reject");
			callback(false, 403, "Origin not allowed");
			return;
		}
		// Connection limit — prevent resource exhaustion
		if (wss.clients.size >= MAX_WS_CONNECTIONS) {
			recordWsEvent("ssh", "reject");
			callback(false, 503, "Too many connections");
			return;
		}
		callback(true);
	},
});
server.on("upgrade", (req, socket, head) => {
 const path = parseSshWsRequestPath(req.url);
 if (path === null) { socket.destroy(); return; }
 if (path === "/ssh") wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws, req));
 else if (path !== "/rdp") socket.destroy();
});
sshWss = wss;

void getSshTerminalRuntimeConfigWithFallback().then((config) => startWsHeartbeat(config.wsHeartbeatIntervalMs));

// ── Origin validation (WebSocket CSRF protection) ──────────────────

const ALLOWED_ORIGINS = config.ssh.wsAllowedOrigins.map((s) => s.trim().toLowerCase()).filter(Boolean);

function isOriginAllowed(req: import("http").IncomingMessage): boolean {
	if (ALLOWED_ORIGINS.length === 0) {
		// Strict: reject connections when no origins are configured.
		// This prevents WebSocket CSRF when SSH_WS_ALLOWED_ORIGINS is missing.
		logger.error("SSH_WS_ALLOWED_ORIGINS is not configured — rejecting WebSocket connection. Set this env var to allow connections.");
		return false;
	}
	const origin = (req.headers.origin || "").trim().toLowerCase();
	if (!origin) return false; // browser WebSocket always sends Origin
	return ALLOWED_ORIGINS.includes(origin);
}


function extractCookie(cookieHeader: string | undefined, name: string): string | null {
	if (!cookieHeader) return null;
	const prefix = `${name}=`;
	for (const part of cookieHeader.split(";")) {
		const trimmed = part.trim();
		if (!trimmed.startsWith(prefix)) continue;
		try {
			return decodeURIComponent(trimmed.slice(prefix.length));
		} catch {
			return trimmed.slice(prefix.length);
		}
	}
	return null;
}

/**
 * Resolve the session token from the HttpOnly session cookie only.
 *
 * The session JWT is long-lived and grants full app access, so it must never
 * travel in the URL query string (leaks into proxy/access logs, browser
 * history, Referer). The browser client sends only serverId + handshake in the
 * query and relies on the same-origin cookie for auth, so a query fallback is
 * dead weight and a liability — removed.
 */
function resolveSshSessionToken(req: import("http").IncomingMessage): string | null {
	const fromCookie = extractCookie(req.headers.cookie, getSessionCookieName());
	return fromCookie && fromCookie.trim() ? fromCookie.trim() : null;
}

wss.on("connection", async (ws, req) => {
	if (wss.clients.size > 64) {
		ws.close(1013, "Terminal capacity reached");
		return;
	}
	recordWsEvent("ssh", "open");
	setWsActive("ssh", wss.clients.size);
	wsHeartbeatState.set(ws, true);
	ws.on("pong", () => {
		wsHeartbeatState.set(ws, true);
	});
	ws.on("close", () => {
		wsHeartbeatState.delete(ws);
		recordWsEvent("ssh", "close");
		setWsActive("ssh", wss.clients.size);
	});
	ws.on("error", () => {
		recordWsEvent("ssh", "error");
	});

	if (!isOriginAllowed(req)) {
		recordWsEvent("ssh", "reject");
		ws.send(JSON.stringify({ type: "error", data: t("backend.sshTerminal.originNotAllowed") }));
		ws.close();
		return;
	}

	// Fixed base — see the request handler above for why the Host header must
	// not feed the URL constructor here.
	const url = new URL(req.url || "/", "http://localhost");
	const serverId = url.searchParams.get("serverId");
	const handshake = url.searchParams.get("handshake");
	const token = resolveSshSessionToken(req);

 if (!serverId || !token || !handshake) {
	 ws.send(JSON.stringify({ type: "error", data: t("backend.sshTerminal.missingParams") }));
	 ws.close();
	 return;
	 }

  let session: SessionPayload;
  try {
    session = await withAuthorizationDeadline(verifySessionToken(token));
  } catch {
    ws.send(JSON.stringify({ type: "error", data: t("backend.sshTerminal.authFailed") }));
    ws.close();
    return;
  }

  if (!canUseSshTerminal(session)) {
    ws.send(JSON.stringify({ type: "error", data: t("backend.sshTerminal.permissionDenied") }));
    ws.close();
    return;
  }

  if (ws.readyState !== WebSocket.OPEN) return;
  const userConnections = activeSshConnectionsByUser.get(session.userId) ?? 0;
  if (userConnections >= 8) { ws.close(1013, "User terminal capacity reached"); return; }
  activeSshConnectionsByUser.set(session.userId, userConnections + 1);
  ws.once("close", () => {
    const count = (activeSshConnectionsByUser.get(session.userId) ?? 1) - 1;
    if (count <= 0) activeSshConnectionsByUser.delete(session.userId);
    else activeSshConnectionsByUser.set(session.userId, count);
  });

  if (SSH_WS_SECRET) {
    const origin = (req.headers.origin || "").trim();
    const handshakePayload = verifySshWsHandshakeToken(handshake, {
      serverId,
      origin,
      sessionId: token,
      secret: SSH_WS_SECRET,
    });
    if (!handshakePayload || handshakePayload.userId !== session.userId) {
      ws.send(JSON.stringify({ type: "error", data: t("backend.sshTerminal.handshakeTokenInvalid") }));
      ws.close();
      return;
    }
  }

  let connParams;
  try {
    connParams = await withAuthorizationDeadline(resolveServerConnection(serverId, session));
  } catch (error) {
    logger.error("failed to resolve SSH connection", error, { serverId, userId: session.userId });
    ws.send(JSON.stringify({ type: "error", data: t("backend.sshTerminal.connectionInfoDecryptFailed") }));
    ws.close();
    return;
  }
  if (!connParams) {
    ws.send(JSON.stringify({ type: "error", data: t("backend.sshTerminal.connectionInfoMissing") }));
    ws.close();
    return;
  }

	const sshClient = new Client();
	const terminalRuntimeConfig = await getSshTerminalRuntimeConfigWithFallback();
	let sshStream: import("ssh2").ClientChannel | undefined;
	let stopped = false;
	let paused = false;
	let lastAuthorizedAt = Date.now();
	let authorizationCheck: Promise<boolean> | null = null;
	let pendingInputBytes = 0;
	let pendingInputMessages = 0;
	let authorizationTimer: NodeJS.Timeout | undefined;
	let drainTimer: NodeJS.Timeout | undefined;
	const endpointHash = createHash("sha256").update(JSON.stringify(connParams)).digest("hex");
	const stopTerminal = (message: string, code = 1008) => {
		if (stopped) return;
		stopped = true;
		clearIdle();
		clearInterval(authorizationTimer);
		clearInterval(drainTimer);
		authorizationTimer = undefined;
		drainTimer = undefined;
		if (ws.readyState === WebSocket.OPEN) {
			if (ws.bufferedAmount < SSH_MAX_QUEUED_BYTES) ws.send(JSON.stringify({ type: "error", data: message }));
			ws.close(code, "SSH terminal closed");
		}
		try { sshStream?.close(); } catch { /* already closed */ }
		try { sshClient.end(); } catch { /* already closed */ }
	};
	const ensureAuthorized = (force = false): Promise<boolean> => {
		if (stopped) return Promise.resolve(false);
		if (authorizationCheck) return authorizationCheck;
		if (!force && Date.now() - lastAuthorizedAt < SSH_AUTH_REVALIDATION_MS) return Promise.resolve(true);
		authorizationCheck = (async () => {
			let deadline: NodeJS.Timeout | undefined;
			try {
				await Promise.race([
					(async () => {
						const current = await verifySessionToken(token);
						if (current.userId !== session.userId || current.currentTeamId !== session.currentTeamId || !canUseSshTerminal(current)) throw new Error("Denied");
						const endpoint = await resolveServerConnection(serverId, current);
						if (!endpoint || createHash("sha256").update(JSON.stringify(endpoint)).digest("hex") !== endpointHash) throw new Error("Changed");
					})(),
					new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error("Authorization unavailable")), 5_000); }),
				]);
				lastAuthorizedAt = Date.now();
				return !stopped;
			} catch {
				stopTerminal(t("backend.sshTerminal.authFailed"));
				return false;
			} finally { clearTimeout(deadline); authorizationCheck = null; }
		})();
		return authorizationCheck;
	};
	const sendOutput = (data: Buffer) => {
		if (stopped || ws.readyState !== WebSocket.OPEN) return;
		const message = JSON.stringify({ type: "output", data: data.toString("base64") });
		let queued = 0;
		for (const client of wss.clients) queued += client.bufferedAmount;
		if (ws.bufferedAmount + Buffer.byteLength(message) > SSH_MAX_QUEUED_BYTES || queued + Buffer.byteLength(message) > SSH_MAX_TOTAL_QUEUED_BYTES) {
			stopTerminal(t("backend.sshTerminal.connectionClosed"), 1013);
			return;
		}
		ws.send(message);
		if (ws.bufferedAmount > 1024 * 1024 && !paused) { paused = true; sshStream?.pause(); }
	};

	// Idle guard: unlike the ping/pong heartbeat (which only detects a dead
	// transport), this reaps a *live but unattended* terminal — an open root
	// shell left behind pins an SSH connection + PTY on the target and consumes a
	// slot from the global cap. The clock resets on real activity in EITHER
	// direction (client keystrokes/resize OR server output), so a user watching
	// `tail -f` is never disconnected; only true silence trips it. The limit
	// comes from runtime.sshIdleTimeoutSec (0 = never reap), the same setting
	// the settings page shows — NOT the legacy env-only WS idle value.
	const idleTimeoutMs = terminalRuntimeConfig.sshIdleTimeoutMs ?? 0;
	let idleTimer: NodeJS.Timeout | undefined;
	const clearIdle = () => {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = undefined;
	};
	const resetIdle = () => {
		if (idleTimeoutMs <= 0) return;
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(() => {
			if (ws.readyState === WebSocket.OPEN) {
				ws.send(JSON.stringify({ type: "closed", data: t("backend.sshTerminal.idleClosed", { minutes: idleTimeoutMs / 60_000 }) }));
				ws.close();
			}
			try { sshStream?.close(); } catch { /* best-effort */ }
			try { sshClient.end(); } catch { /* best-effort */ }
		}, idleTimeoutMs);
		idleTimer.unref?.();
	};

  sshClient.on("ready", () => {
    sshClient.shell({ term: "xterm-256color" }, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: "error", data: t("backend.sshTerminal.shellCreationFailed", { message: err.message }) }));
        ws.close();
        return;
      }
      sshStream = stream;
      ws.send(JSON.stringify({ type: "connected", inputAck: true }));
      resetIdle();

      stream.on("data", (data: Buffer) => {
        resetIdle();
        sendOutput(data);
      });

      stream.on("close", () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "closed", data: t("backend.sshTerminal.connectionClosed") }));
          ws.close();
        }
      });

      stream.stderr?.on("data", (data: Buffer) => {
        resetIdle();
        sendOutput(data);
      });
    });
  });

  sshClient.on("error", (err) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "error", data: describeTerminalSshError(err) }));
      ws.close();
    }
  });

  sshClient.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "closed", data: "SSH connection disconnected" }));
      ws.close();
    }
  });

  ws.on("message", (raw, binary) => {
    if (stopped) return;
    try {
      if (binary || Buffer.byteLength(raw.toString()) > SSH_MAX_MESSAGE_BYTES) throw new Error("Invalid message");
      const messageBytes = Buffer.byteLength(raw.toString());
      if (pendingInputMessages >= 64 || pendingInputBytes + messageBytes > 256 * 1024 || pendingSshInputBytes + messageBytes > 8 * 1024 * 1024) throw new Error("Input queue full");
      const msg = JSON.parse(raw.toString());
      if (!msg || typeof msg !== "object") throw new Error("Invalid message");
      if (msg.type === "input") {
        if (typeof msg.data !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(msg.data)) throw new Error("Invalid input");
        if (msg.id !== undefined && (!Number.isSafeInteger(msg.id) || msg.id < 1)) throw new Error("Invalid input sequence");
      } else if (msg.type === "resize") {
        if (!Number.isSafeInteger(msg.rows) || msg.rows < 1 || msg.rows > 500 || !Number.isSafeInteger(msg.cols) || msg.cols < 1 || msg.cols > 1000) throw new Error("Invalid resize");
      } else throw new Error("Invalid message type");
      pendingInputBytes += messageBytes;
      pendingSshInputBytes += messageBytes;
      pendingInputMessages++;
      void ensureAuthorized().then(async (allowed) => {
        if (!allowed || stopped || !sshStream) return;
        resetIdle();
        if (msg.type === "input") {
          if (sshStream.writableLength > 1024 * 1024) { stopTerminal(t("backend.sshTerminal.connectionClosed"), 1013); return; }
          if (msg.id === undefined) {
            // Existing clients retain their original wire protocol.
            sshStream.write(Buffer.from(msg.data, "base64"));
          } else {
            await new Promise<void>((resolve, reject) => {
              sshStream!.write(Buffer.from(msg.data, "base64"), (error?: Error | null) => error ? reject(error) : resolve());
            });
            if (!stopped && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input-ack", id: msg.id }));
          }
        } else sshStream.setWindow(msg.rows, msg.cols, 0, 0);
      }).catch(() => stopTerminal(t("backend.sshTerminal.connectionClosed"))).finally(() => {
        pendingInputBytes -= messageBytes;
        pendingSshInputBytes -= messageBytes;
        pendingInputMessages--;
      });
    } catch {
      stopTerminal(t("backend.sshTerminal.connectionClosed"));
    }
  });

 ws.on("close", () => {
 stopped = true;
 clearInterval(authorizationTimer);
 clearInterval(drainTimer);
 clearIdle();
 if (sshStream) { try { sshStream.close(); } catch {} }
 try { sshClient.end(); } catch {}
 });

 sshClient.on("end", () => {
 // SSH connection ended gracefully — notify client
 if (ws.readyState === WebSocket.OPEN) {
 ws.send(JSON.stringify({ type: "closed", data: "SSH connection ended gracefully, you may try reconnecting" }));
 }
 });

 // OPEN-1: buildTerminalSshConfig pins enforceHostKeyPin, so an unpinned
 // host key fails the handshake here instead of being silently accepted.
 // The awaits above (session verify, runtime config) can outlive the client
 // (tab closed mid-handshake): connecting then would open an SSH shell that
 // only the idle reaper — or nothing, when the idle timeout is disabled —
 // would ever close. Bail instead.
 if (ws.readyState !== WebSocket.OPEN) return;
 if (!await ensureAuthorized(true)) return;
 authorizationTimer = setInterval(() => { void ensureAuthorized(true); }, SSH_AUTH_REVALIDATION_MS);
 authorizationTimer.unref?.();
 drainTimer = setInterval(() => {
  if (paused && !stopped && ws.bufferedAmount < 256 * 1024) { paused = false; sshStream?.resume(); }
 }, 125);
 drainTimer.unref?.();
 sshClient.connect(buildTerminalSshConfig(connParams, terminalRuntimeConfig));
});

const shouldStartServer = process.env.NODE_ENV !== "test";

if (shouldStartServer) {
  server.listen(PORT, HOST, () => {
    // Server start is visible via process lifecycle; no console needed
  });
}

function shutdown() {
 closeRdp();
	if (wsHeartbeatTimer) clearInterval(wsHeartbeatTimer);
	wss.close();
	server.close();
	// $disconnect is async; without waiting (or bounding the wait) the old
	// synchronous process.exit(0) cut it off mid-flight every time. The force
	// timer mirrors server.ts so a stuck handle can never hang the exit.
	const forceExit = setTimeout(() => process.exit(0), 15_000);
	forceExit.unref?.();
	void prisma.$disconnect().finally(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("unhandledRejection", (reason) => {
	logger.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
	// A crash must not report a clean exit: systemd `Restart=on-failure` units
	// and container supervisors key on non-zero exit codes. Best-effort
	// cleanup, then exit 1 so the failure is observable and restarted.
	logger.error("Uncaught exception:", err);
	try {
		closeRdp();
		if (wsHeartbeatTimer) clearInterval(wsHeartbeatTimer);
		wss.close();
		server.close();
		void prisma.$disconnect().catch(() => {});
	} catch {
		// best-effort only
	}
	process.exit(1);
});
