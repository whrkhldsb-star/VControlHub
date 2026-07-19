/**
 * WebSocket-to-SSH proxy server
 * Runs on port 3001 alongside the Next.js app on port 3000.
 * Clients connect with: ws://host:3001/ssh?serverId=xxx&token=xxx
 * The token is the session cookie value (HMAC-signed JWT).
 */

import { createServer } from "http";
import { existsSync, readFileSync } from "node:fs";
import { createHmac, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { Client } from "ssh2";
import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { decryptServerPassword, decryptSshPrivateKey, decryptSshKeyPassphrase } from "@/lib/ssh/ssh-key-crypto";
import { createVerifiedSshConfig } from "@/lib/ssh/client";

import { DEFAULT_ROLE_PERMISSIONS } from "./lib/auth/rbac";
import { canUseSshTerminal } from "./lib/auth/ssh-access";
import { getAppSlug } from "./lib/branding";
import { createLogger } from "./lib/logging";
import { verifySshWsHandshakeToken } from "./lib/auth/ssh-ws-token";
import { getSshTerminalRuntimeConfig } from "./lib/runtime-settings/service";
import {
	getWsSnapshot,
	recordWsEvent,
	setWsActive,
} from "./lib/monitoring/runtime-metrics";

const logger = createLogger("ssh-ws-proxy");

export function loadSshWsRuntimeEnv(cwd = process.cwd()) {
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
	const portText = env.SSH_WS_PORT?.trim() || "3001";
	const port = Number(portText);

	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error("SSH_WS_PORT must be a valid TCP port");
	}

	return { host, port };
}

const { host: HOST, port: PORT } = resolveSshWsListenConfig();

const APP_SLUG = getAppSlug();
const SESSION_ISSUER = config.auth.sessionIssuer || APP_SLUG;
const SESSION_AUDIENCE = config.auth.sessionAudience || `${APP_SLUG}-console`;

function getSessionSecret() {
	return config.auth.sessionSecret ?? "dev-only-session-secret-change-me";
}

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
  roles: string[];
  mustChangePassword: boolean;
  currentTeamId: string | null;
};

type SessionTokenEnvelope = SessionPayload & {
  iss: string;
  aud: string;
  iat: number;
  exp: number;
};

function decodeBase64Url(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function signPayload(payload: string) {
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
}

function verifySessionToken(token: string): SessionPayload | null {
  try {
    const [encodedPayload, providedSignature] = token.split(".");
    if (!encodedPayload || !providedSignature) return null;

    const expectedSignature = signPayload(encodedPayload);
    const providedBuffer = Buffer.from(providedSignature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");

    if (providedBuffer.length !== expectedBuffer.length) return null;
    if (!timingSafeEqual(providedBuffer, expectedBuffer)) return null;

    const payload = JSON.parse(decodeBase64Url(encodedPayload)) as SessionTokenEnvelope;
    if (payload.iss !== SESSION_ISSUER || payload.aud !== SESSION_AUDIENCE) return null;
    if (payload.exp <= Date.now()) return null;

    return {
      userId: payload.userId,
      username: payload.username,
      roles: payload.roles,
      mustChangePassword: payload.mustChangePassword,
      currentTeamId: payload.currentTeamId ?? null,
    };
  } catch {
    return null;
  }
}

// ── Resolve server SSH connection ───────────────────────────────────

/** team:manage may connect to any server; others only own team + legacy null. */
function canBypassTeamScope(roles: string[]): boolean {
  return roles.some((role) => {
    const known = role as keyof typeof DEFAULT_ROLE_PERMISSIONS;
    return DEFAULT_ROLE_PERMISSIONS[known]?.includes("team:manage") ?? false;
  });
}

async function resolveServerConnection(
  serverId: string,
  session: SessionPayload,
) {
 const srv = await prisma.server.findFirst({
  where: {
   id: serverId,
   ...(canBypassTeamScope(session.roles)
     ? {}
     : session.currentTeamId
       ? { OR: [{ teamId: session.currentTeamId }, { teamId: null }] }
       : { teamId: null }),
  },
  select: {
   id: true,
   name: true,
   host: true,
   port: true,
   username: true,
   enabled: true,
   connectionType: true,
   password: true,
   hostKeySha256: true,
   teamId: true,
   sshKey: { select: { privateKey: true, passphrase: true } },
  },
 });
 if (!srv || !srv.enabled) return null;

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

// ── WebSocket server ────────────────────────────────────────────────

const MAX_WS_CONNECTIONS = config.ssh.wsMaxConnections;
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

const server = createServer((req, res) => {
	const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
	// Local-only observability scrape endpoint for the main app.
	if (req.method === "GET" && url.pathname === "/metrics") {
		const active = sshWss?.clients.size ?? 0;
		setWsActive("ssh", active);
		res.writeHead(200, { "Content-Type": "application/json" });
		res.end(JSON.stringify({ websocket: getWsSnapshot().ssh, activeClients: active }));
		return;
	}
	res.writeHead(204);
	res.end();
});

const wss = new WebSocketServer({
	server,
	path: "/ssh",
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

wss.on("connection", async (ws, req) => {
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
		ws.send(JSON.stringify({ type: "error", data: "Origin not allowed" }));
		ws.close();
		return;
	}

	const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
	const serverId = url.searchParams.get("serverId");
	const token = url.searchParams.get("token");
	const handshake = url.searchParams.get("handshake");

 if (!serverId || !token || !handshake) {
 ws.send(JSON.stringify({ type: "error", data: "Missing serverId, token, or handshake parameter" }));
 ws.close();
 return;
 }

  const session = verifySessionToken(token);
  if (!session) {
    ws.send(JSON.stringify({ type: "error", data: "Authentication failed, please log in again" }));
    ws.close();
    return;
  }

  if (!canUseSshTerminal(session)) {
    ws.send(JSON.stringify({ type: "error", data: "Missing SSH terminal permission" }));
    ws.close();
    return;
  }

  if (SSH_WS_SECRET) {
    const origin = (req.headers.origin || "").trim();
    const handshakePayload = verifySshWsHandshakeToken(handshake, {
      serverId,
      origin,
      sessionId: token,
      secret: SSH_WS_SECRET,
    });
    if (!handshakePayload || handshakePayload.userId !== session.userId) {
      ws.send(JSON.stringify({ type: "error", data: "SSH WebSocket temporary token is invalid or expired" }));
      ws.close();
      return;
    }
  }

  let connParams;
  try {
    connParams = await resolveServerConnection(serverId, session);
  } catch (error) {
    logger.error("failed to resolve SSH connection", error, { serverId, userId: session.userId });
    ws.send(JSON.stringify({ type: "error", data: "Unable to decrypt or read VPS connection info, please check node credential configuration" }));
    ws.close();
    return;
  }
  if (!connParams) {
    ws.send(JSON.stringify({ type: "error", data: "Unable to get VPS connection info, please check node configuration" }));
    ws.close();
    return;
  }

	const sshClient = new Client();
	const terminalRuntimeConfig = await getSshTerminalRuntimeConfigWithFallback();
	let sshStream: import("ssh2").ClientChannel | undefined;

  sshClient.on("ready", () => {
    sshClient.shell({ term: "xterm-256color" }, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: "error", data: `Shell creation failed: ${err.message}` }));
        ws.close();
        return;
      }
      sshStream = stream;
      ws.send(JSON.stringify({ type: "connected" }));

      stream.on("data", (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data: data.toString("base64") }));
        }
      });

      stream.on("close", () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "closed", data: "SSH connection closed" }));
          ws.close();
        }
      });

      stream.stderr?.on("data", (data: Buffer) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data: data.toString("base64") }));
        }
      });
    });
  });

  sshClient.on("error", (err) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "error", data: `SSH connection error: ${err.message}` }));
      ws.close();
    }
  });

  sshClient.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "closed", data: "SSH connection disconnected" }));
      ws.close();
    }
  });

  ws.on("message", (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === "input" && sshStream) {
        sshStream.write(Buffer.from(msg.data, "base64"));
      } else if (msg.type === "resize" && sshStream) {
        sshStream.setWindow(msg.rows || 24, msg.cols || 80, 0, 0);
      }
    } catch {
      // Ignore malformed messages
    }
  });

 ws.on("close", () => {
 if (sshStream) { try { sshStream.close(); } catch {} }
 try { sshClient.end(); } catch {}
 });

 sshClient.on("end", () => {
 // SSH connection ended gracefully — notify client
 if (ws.readyState === WebSocket.OPEN) {
 ws.send(JSON.stringify({ type: "closed", data: "SSH connection ended gracefully, you may try reconnecting" }));
 }
 });

 const sshConfig = createVerifiedSshConfig({
 host: connParams.host,
 port: connParams.port,
 username: connParams.username,
 hostKeySha256: connParams.hostKeySha256,
 ...(connParams.connectionType === "SSH_KEY" ? { privateKey: connParams.privateKey, ...(connParams.passphrase ? { passphrase: connParams.passphrase } : {}) } : { password: connParams.password }),
 });
 sshConfig.readyTimeout = 15000;
 sshConfig.timeout = 10000;
 sshConfig.keepaliveInterval = terminalRuntimeConfig.sshKeepaliveIntervalMs;
 sshConfig.keepaliveCountMax = terminalRuntimeConfig.sshKeepaliveCountMax;
 sshClient.connect(sshConfig);
});

const shouldStartServer = process.env.NODE_ENV !== "test";

if (shouldStartServer) {
  server.listen(PORT, HOST, () => {
    // Server start is visible via process lifecycle; no console needed
  });
}

function shutdown() {
	if (wsHeartbeatTimer) clearInterval(wsHeartbeatTimer);
	wss.close();
	server.close();
	prisma.$disconnect();
	process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("unhandledRejection", (reason) => {
	logger.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
	logger.error("Uncaught exception:", err);
	shutdown();
});
