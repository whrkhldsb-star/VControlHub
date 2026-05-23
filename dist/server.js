"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/server.ts
var import_node_http = require("node:http");
var import_next = __toESM(require("next"));

// src/lib/ws/notification-ws.ts
var import_ws = require("ws");

// src/lib/auth/session.ts
var import_node_crypto = require("node:crypto");

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

// src/lib/branding.ts
var DEFAULT_APP_NAME = "whrkhldsb";
function slugifyAppName(value) {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || DEFAULT_APP_NAME;
}
function getAppSlug(env = process.env) {
  return slugifyAppName(env.APP_SLUG || env.APP_NAME || DEFAULT_APP_NAME);
}

// src/lib/auth/session.ts
var logger = createLogger("auth:session");
var APP_SLUG = getAppSlug();
var SESSION_COOKIE_NAME = process.env.AUTH_SESSION_COOKIE_NAME?.trim() || `${APP_SLUG}_session`;
var SESSION_ISSUER = process.env.AUTH_SESSION_ISSUER?.trim() || APP_SLUG;
var SESSION_AUDIENCE = process.env.AUTH_SESSION_AUDIENCE?.trim() || `${APP_SLUG}-console`;
var SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1e3;
function getSessionSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_SESSION_SECRET must be set in production. Set it in .env.local");
    }
    logger.warn("using default development session secret; set AUTH_SESSION_SECRET for production");
    return "dev-only-session-secret-change-me";
  }
  return secret;
}
function decodeBase64Url(input) {
  return Buffer.from(input, "base64url").toString("utf8");
}
function signPayload(payload) {
  return (0, import_node_crypto.createHmac)("sha256", getSessionSecret()).update(payload).digest("base64url");
}
async function verifySessionToken(token) {
  const [encodedPayload, providedSignature] = token.split(".");
  if (!encodedPayload || !providedSignature) {
    throw new Error("Invalid session token format");
  }
  const expectedSignature = signPayload(encodedPayload);
  const providedBuffer = Buffer.from(providedSignature, "utf8");
  const expectedBuffer = Buffer.from(expectedSignature, "utf8");
  if (providedBuffer.length !== expectedBuffer.length) {
    throw new Error("Invalid session token signature");
  }
  const signaturesMatch = (0, import_node_crypto.timingSafeEqual)(providedBuffer, expectedBuffer);
  if (!signaturesMatch) {
    throw new Error("Invalid session token signature");
  }
  const payload = JSON.parse(decodeBase64Url(encodedPayload));
  if (payload.iss !== SESSION_ISSUER || payload.aud !== SESSION_AUDIENCE) {
    throw new Error("Invalid session token audience");
  }
  if (payload.exp <= Date.now()) {
    throw new Error("Session token expired");
  }
  return {
    userId: payload.userId,
    username: payload.username,
    roles: payload.roles,
    mustChangePassword: payload.mustChangePassword
  };
}
var PENDING_2FA_COOKIE_NAME = `${APP_SLUG}_pending_2fa`;
var PENDING_2FA_TTL_MS = 5 * 60 * 1e3;

// src/lib/ws/notification-ws.ts
var logger2 = createLogger("ws:notification");
var userConnections = /* @__PURE__ */ new Map();
function addConnection(userId, ws) {
  if (!userConnections.has(userId)) userConnections.set(userId, /* @__PURE__ */ new Set());
  userConnections.get(userId).add(ws);
}
function removeConnection(userId, ws) {
  const conns = userConnections.get(userId);
  if (conns) {
    conns.delete(ws);
    if (conns.size === 0) userConnections.delete(userId);
  }
}
var wss = null;
function setupWebSocketServer(server) {
  if (wss) return;
  wss = new import_ws.WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }
    const token = url.searchParams.get("token");
    if (!token) {
      socket.destroy();
      return;
    }
    (async () => {
      try {
        const session = await verifySessionToken(token);
        if (!session) {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit("connection", ws, request, session);
        });
      } catch {
        socket.destroy();
      }
    })();
  });
  wss.on("connection", (ws, _req, session) => {
    const userId = session.userId;
    addConnection(userId, ws);
    ws.send(JSON.stringify({ type: "connected", userId }));
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === "ping") {
          ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        }
      } catch {
      }
    });
    ws.on("close", () => {
      removeConnection(userId, ws);
    });
    ws.on("error", () => {
      removeConnection(userId, ws);
    });
  });
  logger2.info("WebSocket notification server initialized");
}

// src/server.ts
var logger3 = createLogger("server");
var dev = process.env.NODE_ENV !== "production";
var hostname = dev ? "0.0.0.0" : "127.0.0.1";
var port = parseInt(process.env.PORT || "3000", 10);
async function main() {
  const app = (0, import_next.default)({ dev, hostname, port });
  const handle = app.getRequestHandler();
  await app.prepare();
  const server = (0, import_node_http.createServer)(async (req, res) => {
    await handle(req, res);
  });
  setupWebSocketServer(server);
  server.listen(port, hostname, () => {
    logger3.info(`Next.js (${dev ? "dev" : "prod"}) + WS listening on http://${hostname}:${port}`);
  });
}
main().catch((err) => {
  logger3.error("Failed to start:", err);
  process.exit(1);
});
