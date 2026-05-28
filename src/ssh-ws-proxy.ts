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
import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";

import { canUseSshTerminal } from "./lib/auth/ssh-access";
import { getAppSlug } from "./lib/branding";
import { createLogger } from "./lib/logging";
import { verifySshWsHandshakeToken } from "./lib/auth/ssh-ws-token";

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
			process.env[key] = rawValue.trim().replace(/^['\"]|['\"]$/g, "");
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
const SESSION_ISSUER = process.env.AUTH_SESSION_ISSUER?.trim() || APP_SLUG;
const SESSION_AUDIENCE = process.env.AUTH_SESSION_AUDIENCE?.trim() || `${APP_SLUG}-console`;

function getSessionSecret() {
 return process.env.AUTH_SESSION_SECRET ?? "dev-only-session-secret-change-me";
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
    };
  } catch {
    return null;
  }
}

// ── Resolve server SSH connection ───────────────────────────────────

async function resolveServerConnection(serverId: string) {
 const srv = await prisma.server.findUnique({
  where: { id: serverId },
  select: {
   id: true,
   name: true,
   host: true,
   port: true,
   username: true,
   enabled: true,
   connectionType: true,
   password: true,
   sshKey: { select: { privateKey: true } },
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
	privateKey: srv.connectionType === "SSH_KEY" ? decryptSshPrivateKey(srv.sshKey!.privateKey ?? "") : undefined,
	password: srv.connectionType === "PASSWORD" ? decryptServerPassword(srv.password ?? "") : undefined,
 };
}

// ── WebSocket server ────────────────────────────────────────────────

const server = createServer((_req, res) => {
 res.writeHead(204);
 res.end();
});

const MAX_WS_CONNECTIONS = parseInt(process.env.SSH_WS_MAX_CONNECTIONS || "50", 10);

const wss = new WebSocketServer({
	server,
	path: "/ssh",
	verifyClient(info, callback) {
		if (!isOriginAllowed(info.req)) {
			callback(false, 403, "Origin not allowed");
			return;
		}
		// Connection limit — prevent resource exhaustion
		if (wss.clients.size >= MAX_WS_CONNECTIONS) {
			callback(false, 503, "Too many connections");
			return;
		}
		callback(true);
	},
});

// ── Origin validation (WebSocket CSRF protection) ──────────────────

const ALLOWED_ORIGINS = (process.env.SSH_WS_ALLOWED_ORIGINS?.trim() || "")
	.split(",")
	.map((s) => s.trim().toLowerCase())
	.filter(Boolean);

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
	if (!isOriginAllowed(req)) {
		ws.send(JSON.stringify({ type: "error", data: "Origin 不被允许" }));
		ws.close();
		return;
	}

	const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
	const serverId = url.searchParams.get("serverId");
	const token = url.searchParams.get("token");
	const handshake = url.searchParams.get("handshake");

 if (!serverId || !token || !handshake) {
 ws.send(JSON.stringify({ type: "error", data: "缺少 serverId、token 或 handshake 参数" }));
 ws.close();
 return;
 }

  const session = verifySessionToken(token);
  if (!session) {
    ws.send(JSON.stringify({ type: "error", data: "认证失败，请重新登录" }));
    ws.close();
    return;
  }

  if (!canUseSshTerminal(session)) {
    ws.send(JSON.stringify({ type: "error", data: "缺少 SSH 终端权限" }));
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
      ws.send(JSON.stringify({ type: "error", data: "SSH WebSocket 临时令牌无效或已过期" }));
      ws.close();
      return;
    }
  }

  const connParams = await resolveServerConnection(serverId);
  if (!connParams) {
    ws.send(JSON.stringify({ type: "error", data: "无法获取 VPS 连接信息，请检查节点配置" }));
    ws.close();
    return;
  }

	const sshClient = new Client();
	let sshStream: import("ssh2").ClientChannel | undefined;

  sshClient.on("ready", () => {
    sshClient.shell({ term: "xterm-256color" }, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: "error", data: `Shell 创建失败: ${err.message}` }));
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
          ws.send(JSON.stringify({ type: "closed", data: "SSH 连接已关闭" }));
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
      ws.send(JSON.stringify({ type: "error", data: `SSH 连接错误: ${err.message}` }));
      ws.close();
    }
  });

  sshClient.on("close", () => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "closed", data: "SSH 连接已断开" }));
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
 ws.send(JSON.stringify({ type: "closed", data: "SSH 连接已正常断开，可尝试重连" }));
 }
 });

 sshClient.connect({
 host: connParams.host,
 port: connParams.port,
 username: connParams.username,
 ...(connParams.connectionType === "SSH_KEY" ? { privateKey: connParams.privateKey } : { password: connParams.password }),
 readyTimeout: 15000,
 timeout: 10000,
 keepaliveInterval: 15000,
 keepaliveCountMax: 3,
 });
});

const shouldStartServer = process.env.NODE_ENV !== "test";

if (shouldStartServer) {
  server.listen(PORT, HOST, () => {
    // Server start is visible via process lifecycle; no console needed
  });
}

process.on("SIGTERM", () => { wss.close(); server.close(); prisma.$disconnect(); process.exit(0); });
process.on("SIGINT", () => { wss.close(); server.close(); prisma.$disconnect(); process.exit(0); });
