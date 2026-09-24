/**
 * WebSocket real-time notification push service.
 * Uses the existing `ws` dependency to create a lightweight WS server
 * alongside the Next.js HTTP server.
 *
 * Architecture:
 * - WS server listens on the same port (upgraded from HTTP)
 * - Clients authenticate via cookie or token in query params
 * - Server broadcasts notifications to the target user's connections
 * - Falls back gracefully if WS is not available
 */
import type { IncomingMessage } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { SessionPayload } from "@/lib/auth/session";
import { getSessionCookieName, verifySessionToken } from "@/lib/auth/session";
import { createLogger } from "@/lib/logging";
import { recordWsEvent, setWsActive } from "@/lib/monitoring/runtime-metrics";

const logger = createLogger("ws:notification");

/* ── Connection Registry ─────────────────────────────────── */
const userConnections = new Map<string, Set<WebSocket>>();

/** Hard cap on concurrent notification sockets. Mirrors the SSH proxy cap:
 * one hub process serves a small team, so thousands of sockets can only mean
 * a leak or a reconnect loop, never legitimate load. */
const MAX_WS_CONNECTIONS = 200;

/** Server-side liveness sweep interval. Client JSON pings alone cannot detect
 * a silently-dead transport, and ws keeps queuing broadcast payloads into a
 * dead-but-OPEN socket's send buffer without bound. */
const HEARTBEAT_INTERVAL_MS = 30_000;
/** bufferedAmount beyond this means the peer stopped draining — terminate
 * instead of buffering every future broadcast in memory for it. */
const MAX_BUFFERED_BYTES = 1_000_000;

const heartbeatState = new WeakMap<WebSocket, boolean>();
let heartbeatTimer: NodeJS.Timeout | null = null;

function addConnection(userId: string, ws: WebSocket) {
	if (!userConnections.has(userId)) userConnections.set(userId, new Set());
	userConnections.get(userId)!.add(ws);
	recordWsEvent("notification", "open");
	setWsActive("notification", countActiveConnections());
}

function removeConnection(userId: string, ws: WebSocket) {
	const conns = userConnections.get(userId);
	if (conns) {
		const had = conns.delete(ws);
		if (conns.size === 0) userConnections.delete(userId);
		if (had) {
			recordWsEvent("notification", "close");
			setWsActive("notification", countActiveConnections());
		}
	}
}

function countActiveConnections() {
	let total = 0;
	for (const set of userConnections.values()) total += set.size;
	return total;
}

/* ── Broadcast ───────────────────────────────────────────── */
export type WsMessage =
	| { type: "notification"; data: { id: string; title: string; message: string; actionUrl?: string | null; createdAt: string } }
	| { type: "unread_count"; count: number }
	| { type: "download_progress"; data: { taskId: string; progress: number; status: string } }
	| { type: "server_alert"; data: { serverId: string; serverName: string; message: string } }
	| { type: "pong"; ts: number };

export function broadcastToUser(userId: string, message: WsMessage) {
	const conns = userConnections.get(userId);
	if (!conns || conns.size === 0) return;
	const payload = JSON.stringify(message);
	for (const ws of conns) {
		if (ws.readyState !== WebSocket.OPEN) continue;
		if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
			// The peer stopped draining its socket — dead in practice. Drop it
			// instead of letting ws keep buffering every broadcast for it.
			ws.terminate();
			continue;
		}
		ws.send(payload);
	}
}

/* ── WebSocket Server Setup ──────────────────────────────── */
let wss: WebSocketServer | null = null;
let detachUpgradeHandler: (() => void) | null = null;

export function getWsServer(): WebSocketServer | null {
	return wss;
}

export function closeWebSocketServer(): void {
	if (heartbeatTimer) {
		clearInterval(heartbeatTimer);
		heartbeatTimer = null;
	}
	if (!wss) return;
	detachUpgradeHandler?.();
	detachUpgradeHandler = null;
	for (const client of wss.clients) {
		client.terminate();
	}
	wss.close();
	wss = null;
	userConnections.clear();
	setWsActive("notification", 0);
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

function resolveUpgradeSessionToken(request: IncomingMessage): string | null {
	// HttpOnly session cookie only. A `?token=` query fallback was removed: the
	// full session credential in the URL lands in reverse-proxy access logs,
	// browser history and Referer, and this upgrade path has no rate limiter.
	// Browser clients always send cookies on same-origin upgrades; scripted
	// clients can send the same cookie header.
	return extractCookie(request.headers.cookie, getSessionCookieName());
}

/**
 * This endpoint only ever serves same-origin browser clients, so an Origin
 * header naming a different host means a cross-site page is attempting the
 * handshake. The HttpOnly cookie is SameSite=Lax and would not be sent on a
 * cross-site upgrade in modern browsers, but enforcing it here is cheap
 * defense-in-depth (and covers browsers without SameSite enforcement).
 * Requests with no Origin / opaque "null" (non-browser clients, some tooling)
 * are authenticated by the cookie alone.
 */
function isCrossOriginUpgrade(request: IncomingMessage): boolean {
	const origin = request.headers.origin;
	if (!origin || origin === "null") return false;
	let originHost: string;
	try {
		originHost = new URL(origin).host.toLowerCase();
	} catch {
		return true;
	}
	if (!originHost) return true;
	const forwarded = request.headers["x-forwarded-host"];
	const expected = (
		(typeof forwarded === "string" && forwarded.split(",")[0]?.trim()) ||
		request.headers.host ||
		""
	)
		.toString()
		.trim()
		.toLowerCase();
	if (!expected) return false;
	return originHost !== expected;
}

export function setupWebSocketServer(
	server: import("node:http").Server,
	options: {
		/**
		 * Handler for upgrade requests this server does not own (any path other
		 * than /ws). Wired to Next's own upgrade handler so `/_next/webpack-hmr`
		 * keeps working in dev when running through the custom server; without
		 * it every foreign upgrade was hard-destroyed.
		 */
		onForeignUpgrade?: (request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => void;
	} = {},
) {
	if (wss) return; // already initialized

	const instance = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
	wss = instance;

	// Handle HTTP upgrade requests
	const handleUpgrade = (request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
		// Only handle /ws path
		let url: URL;
		try {
			url = new URL(request.url || "/", "http://localhost");
		} catch {
			recordWsEvent("notification", "reject");
			socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
			return;
		}
		if (url.pathname !== "/ws") {
			if (options.onForeignUpgrade) {
				options.onForeignUpgrade(request, socket, head);
				return;
			}
			socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}

		if (isCrossOriginUpgrade(request)) {
			recordWsEvent("notification", "reject");
			socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}

		if (instance.clients.size >= MAX_WS_CONNECTIONS) {
			recordWsEvent("notification", "reject");
			socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}

		// Authenticate via HttpOnly session cookie (see resolveUpgradeSessionToken).
		const token = resolveUpgradeSessionToken(request);
		if (!token) {
			recordWsEvent("notification", "reject");
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}

		(async () => {
			try {
				const session = await verifySessionToken(token);
				if (!session || wss !== instance || socket.destroyed) {
					recordWsEvent("notification", "reject");
					socket.destroy();
					return;
				}

				instance.handleUpgrade(request, socket, head, (ws) => {
					instance.emit("connection", ws, request, session);
				});
			} catch {
				// Upgrade failed (bad session, protocol error, etc.) — drop the socket.
				recordWsEvent("notification", "reject");
				socket.destroy();
			}
		})();
	};
	server.on("upgrade", handleUpgrade);
	detachUpgradeHandler = () => server.off("upgrade", handleUpgrade);

	instance.on("connection", (ws: WebSocket, _req: IncomingMessage, session: SessionPayload) => {
		const userId = session.userId;
		addConnection(userId, ws);
		heartbeatState.set(ws, true);
		ws.on("pong", () => {
			heartbeatState.set(ws, true);
		});

		// Send initial unread count
		ws.send(JSON.stringify({ type: "connected", userId }));

		// Heartbeat: client sends ping, server responds pong
		ws.on("message", (data: Buffer) => {
			try {
				const msg = JSON.parse(data.toString());
				if (msg.type === "ping") {
					ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
				}
			} catch { /* ignore malformed messages */ }
		});

		ws.on("close", () => {
			removeConnection(userId, ws);
		});

		ws.on("error", () => {
			recordWsEvent("notification", "error");
			removeConnection(userId, ws);
		});
	});

	// Server-side liveness sweep (same pattern as the SSH WS proxy): a peer
	// that misses a pong window is terminated, so dead transports leave the
	// per-user sets instead of accumulating forever.
	heartbeatTimer = setInterval(() => {
		for (const client of instance.clients) {
			if (client.readyState !== WebSocket.OPEN) continue;
			if (heartbeatState.get(client) === false) {
				client.terminate();
				continue;
			}
			heartbeatState.set(client, false);
			client.ping();
		}
	}, HEARTBEAT_INTERVAL_MS);
	heartbeatTimer.unref?.();

	logger.info("WebSocket notification server initialized");
}

/* ── Convenience: push notification to user ──────────────── */
export function pushNotification(userId: string, data: {
	id: string; title: string; message: string; actionUrl?: string | null; createdAt: string;
}) {
	broadcastToUser(userId, { type: "notification", data });
}

export function pushUnreadCount(userId: string, count: number) {
	broadcastToUser(userId, { type: "unread_count", count });
}

export function pushDownloadProgress(userId: string, data: { taskId: string; progress: number; status: string }) {
	broadcastToUser(userId, { type: "download_progress", data });
}

export function pushServerAlert(userId: string, data: { serverId: string; serverName: string; message: string }) {
	broadcastToUser(userId, { type: "server_alert", data });
}
