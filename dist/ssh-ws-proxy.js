"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/ssh-ws-proxy.ts
var ssh_ws_proxy_exports = {};
__export(ssh_ws_proxy_exports, {
  requireSshWsSecret: () => requireSshWsSecret,
  resolveSshWsListenConfig: () => resolveSshWsListenConfig
});
module.exports = __toCommonJS(ssh_ws_proxy_exports);
var import_http = require("http");
var import_node_crypto = require("node:crypto");
var import_ws = require("ws");
var import_ssh2 = require("ssh2");
var import_client = require("@prisma/client");
var import_adapter_pg = require("@prisma/adapter-pg");

// src/lib/auth/rbac.ts
var PERMISSIONS = [
  "announcement:manage",
  "api-token:manage",
  "audit:read",
  "ai:manage",
  "backup:create",
  "backup:read",
  "backup:restore",
  "command:approve",
  "command:create",
  "command:execute",
  "command:read",
  "deploy:manage",
  "deploy:read",
  "deploy:run",
  "deploy:export",
  "docker:manage",
  "health:read",
  "image:read",
  "image:write",
  "media:manage",
  "notification:manage",
  "role:manage",
  "server:read",
  "server:ssh",
  "server:write",
  "share:create",
  "share:manage",
  "share:read",
  "snippet:manage",
  "storage:delete",
  "storage:manage-node",
  "storage:read",
  "storage:write",
  "task:read",
  "ticket:manage",
  "user:manage",
  "user:read"
];
var ALL_PERMISSIONS = [...PERMISSIONS];
var DEFAULT_ROLE_PERMISSIONS = {
  admin: ALL_PERMISSIONS,
  operator: [
    "announcement:manage",
    "api-token:manage",
    "audit:read",
    "ai:manage",
    "backup:create",
    "backup:read",
    "command:create",
    "command:execute",
    "command:read",
    "deploy:read",
    "deploy:run",
    "deploy:export",
    "docker:manage",
    "health:read",
    "media:manage",
    "notification:manage",
    "server:read",
    "server:ssh",
    "server:write",
    "share:create",
    "share:manage",
    "share:read",
    "snippet:manage",
    "storage:read",
    "storage:write",
    "task:read",
    "ticket:manage",
    "user:read"
  ],
  viewer: [
    "audit:read",
    "backup:read",
    "command:read",
    "deploy:read",
    "health:read",
    "server:read",
    "share:read",
    "storage:read",
    "task:read",
    "user:read"
  ],
  storage_manager: [
    "audit:read",
    "backup:read",
    "command:read",
    "health:read",
    "media:manage",
    "server:read",
    "share:create",
    "share:manage",
    "share:read",
    "snippet:manage",
    "storage:delete",
    "storage:manage-node",
    "storage:read",
    "storage:write",
    "task:read",
    "ticket:manage",
    "user:read"
  ]
};

// src/lib/auth/ssh-access.ts
function canUseSshTerminal(session) {
  return session.roles.some((role) => {
    const knownRole = role;
    return DEFAULT_ROLE_PERMISSIONS[knownRole]?.includes("server:ssh") ?? false;
  });
}

// src/lib/branding.ts
var DEFAULT_APP_NAME = "whrkhldsb";
function slugifyAppName(value) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || DEFAULT_APP_NAME;
}
function getAppSlug(env = process.env) {
  return slugifyAppName(env.APP_SLUG || env.APP_NAME || DEFAULT_APP_NAME);
}

// src/lib/logging.ts
var SENSITIVE_KEY_PATTERN = /(?:password|passwd|pwd|secret|token|authorization|cookie|private.?key|database.?url|dsn|credential|api.?key)/i;
var SECRET_VALUE_PATTERNS = [
  /postgres(?:ql)?:\/\/[^\s]+/i,
  /mysql:\/\/[^\s]+/i,
  /mongodb(?:\+srv)?:\/\/[^\s]+/i,
  /redis:\/\/[^\s]+/i,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/i,
  /password\s*=\s*[^\s,;]+/i,
  /token\s*=\s*[^\s,;]+/i,
  /secret\s*=\s*[^\s,;]+/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/i
];
var MAX_DEPTH = 6;
function redactString(value) {
  return SECRET_VALUE_PATTERNS.reduce((current, pattern) => current.replace(pattern, "[REDACTED]"), value);
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;
}
function redactSensitiveValue(value, key = "", depth = 0) {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactString(value.message),
      stack: process.env.NODE_ENV === "production" ? void 0 : redactString(value.stack ?? "")
    };
  }
  if (depth >= MAX_DEPTH) return "[Truncated]";
  if (Array.isArray(value)) return value.map((item) => redactSensitiveValue(item, "", depth + 1));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redactSensitiveValue(entryValue, entryKey, depth + 1)])
    );
  }
  return redactString(String(value));
}
function emit(level, scope, message, errorOrContext, context) {
  if (level === "debug" && process.env.NODE_ENV === "production") return;
  const payload = {
    level,
    scope,
    message,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
  if (errorOrContext instanceof Error) {
    payload.error = redactSensitiveValue(errorOrContext);
    if (context) payload.context = redactSensitiveValue(context);
  } else if (errorOrContext !== void 0) {
    payload.context = redactSensitiveValue(errorOrContext);
  }
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
function createLogger(scope) {
  return {
    debug: (message, context) => emit("debug", scope, message, context),
    info: (message, context) => emit("info", scope, message, context),
    warn: (message, errorOrContext, context) => emit("warn", scope, message, errorOrContext, context),
    error: (message, error, context) => emit("error", scope, message, error, context)
  };
}
var defaultLogger = createLogger("app");

// src/ssh-ws-proxy.ts
var logger = createLogger("ssh-ws-proxy");
function resolveSshWsListenConfig(env = process.env) {
  const host = env.SSH_WS_HOST?.trim() || "127.0.0.1";
  const portText = env.SSH_WS_PORT?.trim() || "3001";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("SSH_WS_PORT must be a valid TCP port");
  }
  return { host, port };
}
var { host: HOST, port: PORT } = resolveSshWsListenConfig();
var APP_SLUG = getAppSlug();
var SESSION_ISSUER = process.env.AUTH_SESSION_ISSUER?.trim() || APP_SLUG;
var SESSION_AUDIENCE = process.env.AUTH_SESSION_AUDIENCE?.trim() || `${APP_SLUG}-console`;
function getSessionSecret() {
  return process.env.AUTH_SESSION_SECRET ?? "dev-only-session-secret-change-me";
}
function requireSshWsSecret(env = process.env) {
  const secret = env.SSH_WS_SECRET?.trim() || void 0;
  const nodeEnv = env.NODE_ENV?.trim() || "development";
  if (!secret) {
    if (nodeEnv === "production") {
      throw new Error("SSH_WS_SECRET must be set in production");
    }
    logger.warn(
      "\u26A0 SSH_WS_SECRET is not set \u2014 skipping WS secret validation (development only). Set SSH_WS_SECRET before deploying to production."
    );
  }
  return secret;
}
var SSH_WS_SECRET = requireSshWsSecret();
var prismaAdapter = new import_adapter_pg.PrismaPg(process.env.DATABASE_URL);
var prisma = new import_client.PrismaClient({
  adapter: prismaAdapter,
  log: ["error"]
});
function decodeBase64Url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}
function signPayload(payload) {
  return (0, import_node_crypto.createHmac)("sha256", getSessionSecret()).update(payload).digest("base64url");
}
function verifySessionToken(token) {
  try {
    const [encodedPayload, providedSignature] = token.split(".");
    if (!encodedPayload || !providedSignature) return null;
    const expectedSignature = signPayload(encodedPayload);
    const providedBuffer = Buffer.from(providedSignature, "utf8");
    const expectedBuffer = Buffer.from(expectedSignature, "utf8");
    if (providedBuffer.length !== expectedBuffer.length) return null;
    if (!(0, import_node_crypto.timingSafeEqual)(providedBuffer, expectedBuffer)) return null;
    const payload = JSON.parse(decodeBase64Url(encodedPayload));
    if (payload.iss !== SESSION_ISSUER || payload.aud !== SESSION_AUDIENCE) return null;
    if (payload.exp <= Date.now()) return null;
    return {
      userId: payload.userId,
      username: payload.username,
      roles: payload.roles,
      mustChangePassword: payload.mustChangePassword
    };
  } catch {
    return null;
  }
}
async function resolveServerConnection(serverId) {
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
      sshKey: { select: { privateKey: true } }
    }
  });
  if (!srv || !srv.enabled) return null;
  if (srv.connectionType === "SSH_KEY" && !srv.sshKey?.privateKey) return null;
  if (srv.connectionType === "PASSWORD" && !srv.password) return null;
  return {
    host: srv.host,
    port: srv.port,
    username: srv.username,
    connectionType: srv.connectionType,
    privateKey: srv.connectionType === "SSH_KEY" ? srv.sshKey.privateKey ?? void 0 : void 0,
    password: srv.connectionType === "PASSWORD" ? srv.password ?? void 0 : void 0
  };
}
var server = (0, import_http.createServer)((_req, res) => {
  res.writeHead(204);
  res.end();
});
var MAX_WS_CONNECTIONS = parseInt(process.env.SSH_WS_MAX_CONNECTIONS || "50", 10);
var wss = new import_ws.WebSocketServer({
  server,
  path: "/ssh",
  verifyClient(info, callback) {
    if (!isOriginAllowed(info.req)) {
      callback(false, 403, "Origin not allowed");
      return;
    }
    if (wss.clients.size >= MAX_WS_CONNECTIONS) {
      callback(false, 503, "Too many connections");
      return;
    }
    callback(true);
  }
});
var ALLOWED_ORIGINS = (process.env.SSH_WS_ALLOWED_ORIGINS?.trim() || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
function isOriginAllowed(req) {
  if (ALLOWED_ORIGINS.length === 0) {
    logger.error("SSH_WS_ALLOWED_ORIGINS is not configured \u2014 rejecting WebSocket connection. Set this env var to allow connections.");
    return false;
  }
  const origin = (req.headers.origin || "").trim().toLowerCase();
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin);
}
wss.on("connection", async (ws, req) => {
  if (!isOriginAllowed(req)) {
    ws.send(JSON.stringify({ type: "error", data: "Origin \u4E0D\u88AB\u5141\u8BB8" }));
    ws.close();
    return;
  }
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const serverId = url.searchParams.get("serverId");
  const token = url.searchParams.get("token");
  const wsSecret = url.searchParams.get("secret");
  if (SSH_WS_SECRET) {
    if (!wsSecret || !(0, import_node_crypto.timingSafeEqual)(Buffer.from(wsSecret), Buffer.from(SSH_WS_SECRET))) {
      ws.send(JSON.stringify({ type: "error", data: "\u7F3A\u5C11\u6216\u65E0\u6548\u7684 secret \u53C2\u6570" }));
      ws.close();
      return;
    }
  }
  if (!serverId || !token) {
    ws.send(JSON.stringify({ type: "error", data: "\u7F3A\u5C11 serverId \u6216 token \u53C2\u6570" }));
    ws.close();
    return;
  }
  const session = verifySessionToken(token);
  if (!session) {
    ws.send(JSON.stringify({ type: "error", data: "\u8BA4\u8BC1\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u767B\u5F55" }));
    ws.close();
    return;
  }
  if (!canUseSshTerminal(session)) {
    ws.send(JSON.stringify({ type: "error", data: "\u7F3A\u5C11 SSH \u7EC8\u7AEF\u6743\u9650" }));
    ws.close();
    return;
  }
  const connParams = await resolveServerConnection(serverId);
  if (!connParams) {
    ws.send(JSON.stringify({ type: "error", data: "\u65E0\u6CD5\u83B7\u53D6 VPS \u8FDE\u63A5\u4FE1\u606F\uFF0C\u8BF7\u68C0\u67E5\u8282\u70B9\u914D\u7F6E" }));
    ws.close();
    return;
  }
  const sshClient = new import_ssh2.Client();
  let sshStream;
  sshClient.on("ready", () => {
    sshClient.shell({ term: "xterm-256color" }, (err, stream) => {
      if (err) {
        ws.send(JSON.stringify({ type: "error", data: `Shell \u521B\u5EFA\u5931\u8D25: ${err.message}` }));
        ws.close();
        return;
      }
      sshStream = stream;
      ws.send(JSON.stringify({ type: "connected" }));
      stream.on("data", (data) => {
        if (ws.readyState === import_ws.WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data: data.toString("base64") }));
        }
      });
      stream.on("close", () => {
        if (ws.readyState === import_ws.WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "closed", data: "SSH \u8FDE\u63A5\u5DF2\u5173\u95ED" }));
          ws.close();
        }
      });
      stream.stderr?.on("data", (data) => {
        if (ws.readyState === import_ws.WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "output", data: data.toString("base64") }));
        }
      });
    });
  });
  sshClient.on("error", (err) => {
    if (ws.readyState === import_ws.WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "error", data: `SSH \u8FDE\u63A5\u9519\u8BEF: ${err.message}` }));
      ws.close();
    }
  });
  sshClient.on("close", () => {
    if (ws.readyState === import_ws.WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "closed", data: "SSH \u8FDE\u63A5\u5DF2\u65AD\u5F00" }));
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
    }
  });
  ws.on("close", () => {
    if (sshStream) {
      try {
        sshStream.close();
      } catch {
      }
    }
    try {
      sshClient.end();
    } catch {
    }
  });
  sshClient.on("end", () => {
    if (ws.readyState === import_ws.WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "closed", data: "SSH \u8FDE\u63A5\u5DF2\u6B63\u5E38\u65AD\u5F00\uFF0C\u53EF\u5C1D\u8BD5\u91CD\u8FDE" }));
    }
  });
  sshClient.connect({
    host: connParams.host,
    port: connParams.port,
    username: connParams.username,
    ...connParams.connectionType === "SSH_KEY" ? { privateKey: connParams.privateKey } : { password: connParams.password },
    readyTimeout: 15e3,
    timeout: 1e4,
    keepaliveInterval: 15e3,
    keepaliveCountMax: 3
  });
});
var shouldStartServer = process.env.NODE_ENV !== "test";
if (shouldStartServer) {
  server.listen(PORT, HOST, () => {
  });
}
process.on("SIGTERM", () => {
  wss.close();
  server.close();
  prisma.$disconnect();
  process.exit(0);
});
process.on("SIGINT", () => {
  wss.close();
  server.close();
  prisma.$disconnect();
  process.exit(0);
});
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  requireSshWsSecret,
  resolveSshWsListenConfig
});
