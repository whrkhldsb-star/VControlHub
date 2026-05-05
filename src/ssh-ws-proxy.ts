/**
 * WebSocket-to-SSH proxy server
 * Runs on port 3001 alongside the Next.js app on port 3000.
 * Clients connect with: ws://host:3001/ssh?serverId=xxx&token=xxx
 * The token is the session cookie value (HMAC-signed JWT).
 */

import { createServer } from "http";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { Client } from "ssh2";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

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

const SESSION_ISSUER = "whrkhldsb";
const SESSION_AUDIENCE = "whrkhldsb-console";

function getSessionSecret() {
  return process.env.AUTH_SESSION_SECRET ?? "dev-only-session-secret-change-me";
}

// ── Prisma (matching the main app's initialization) ─────────────────

const prismaAdapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({
  adapter: prismaAdapter,
  log: ["error"],
});

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
	privateKey: srv.connectionType === "SSH_KEY" ? (srv.sshKey!.privateKey ?? undefined) : undefined,
	password: srv.connectionType === "PASSWORD" ? (srv.password ?? undefined) : undefined,
 };
}

// ── WebSocket server ────────────────────────────────────────────────

const server = createServer((_req, res) => {
  res.writeHead(200);
  res.end("SSH WebSocket proxy running");
});

const wss = new WebSocketServer({ server, path: "/ssh" });

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const serverId = url.searchParams.get("serverId");
  const token = url.searchParams.get("token");

  if (!serverId || !token) {
    ws.send(JSON.stringify({ type: "error", data: "缺少 serverId 或 token 参数" }));
    ws.close();
    return;
  }

  const session = verifySessionToken(token);
  if (!session) {
    ws.send(JSON.stringify({ type: "error", data: "认证失败，请重新登录" }));
    ws.close();
    return;
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
