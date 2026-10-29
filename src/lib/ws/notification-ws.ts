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
import { AuthError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import { recordWsEvent, setWsActive } from "@/lib/monitoring/runtime-metrics";
import { getNotificationBus } from "./notification-bus";

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

/** One user (tabs, devices, a reconnect loop) may hold this many sockets; the oldest makes room. */
const MAX_CONNECTIONS_PER_USER = 10;

/** A socket is authenticated once at the upgrade. It is re-checked against the session store this
 * often (on the heartbeat sweep), so signing out everywhere, disabling the account, changing the
 * password or an expired session cuts the push instead of leaving it on for as long as the page stays open. */
const SESSION_RECHECK_INTERVAL_MS = 60_000;
const socketAuth = new WeakMap<WebSocket, { token: string; checkedAt: number }>();

const heartbeatState = new WeakMap<WebSocket, boolean>();
let heartbeatTimer: NodeJS.Timeout | null = null;

function addConnection(userId: string, ws: WebSocket) {
	if (!userConnections.has(userId)) userConnections.set(userId, new Set());
	const own = userConnections.get(userId)!;
	while (own.size >= MAX_CONNECTIONS_PER_USER) {
		const oldest = own.values().next().value as WebSocket | undefined;
		if (!oldest) break;
		own.delete(oldest);
		oldest.terminate();
	}
	own.add(ws);
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
	| { type: "unread_count"; count: number; asOfUs?: number }
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
	// Drop the bus subscription (Redis pub/sub when multi-instance) before
	// clearing the registry it delivers into.
	void getNotificationBus().stop();
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
	// Non-browser clients send no Origin. A literal "null" is a browser in an
	// opaque context (sandboxed iframe, file:// page) and is never this site.
	if (!origin) return false;
	if (origin === "null") return true;
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

let rechecking = false;

/** Drop the sockets whose session is no longer valid. A failure of the check itself (the database
 * restarting) keeps the socket: nothing says its session ended, and the next sweep asks again. */
export async function recheckSocketSessions(minAgeMs = SESSION_RECHECK_INTERVAL_MS): Promise<void> {
	const instance = wss;
	if (!instance || rechecking) return;
	rechecking = true;
	try {
		for (const client of instance.clients) {
			const auth = socketAuth.get(client);
			if (!auth || client.readyState !== WebSocket.OPEN || Date.now() - auth.checkedAt < minAgeMs) continue;
			try {
				await verifySessionToken(auth.token);
				auth.checkedAt = Date.now();
			} catch (error) {
				if (error instanceof AuthError) {
					recordWsEvent("notification", "reject");
					client.terminate();
				}
			}
		}
	} finally {
		rechecking = false;
	}
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
					instance.emit("connection", ws, request, session, token);
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

	instance.on("connection", (ws: WebSocket, _req: IncomingMessage, session: SessionPayload, token: string) => {
		const userId = session.userId;
		socketAuth.set(ws, { token, checkedAt: Date.now() });
		addConnection(userId, ws);
		heartbeatState.set(ws, true);
		ws.on("pong", () => {
			heartbeatState.set(ws, true);
		});

		ws.send(JSON.stringify({ type: "connected", userId }));
		// The badge starts from the stored count: the client shows 0 until a
		// count arrives, and existing unread notifications had no badge.
		void import("@/lib/notification/service")
			.then(({ readUnreadCount }) => readUnreadCount(userId))
			.then(({ count, asOfUs }) => {
				if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "unread_count", count, asOfUs }));
			})
			.catch(() => { /* the HTTP count remains the fallback */ });

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
		void recheckSocketSessions();
	}, HEARTBEAT_INTERVAL_MS);
	heartbeatTimer.unref?.();

	// Multi-instance fan-out: pushes go through the bus, which delivers
	// locally (single instance) or via Redis pub/sub so the instance holding
	// the user's sockets sees every message regardless of origin process.
	void getNotificationBus().start((userId, message) => {
		broadcastToUser(userId, message as WsMessage);
	});

	logger.info("WebSocket notification server initialized");
}

/* ── Convenience: push notification to user ──────────────── */
/** Push helpers fan out through the notification bus (see setupWebSocketServer). */
function publishToUser(userId: string, message: WsMessage) {
	getNotificationBus().publish(userId, message);
}

export function pushNotification(userId: string, data: {
	id: string; title: string; message: string; messageCode?: string | null; messageParams?: unknown;
	actionUrl?: string | null; teamId?: string | null; createdAt: string;
}) {
	publishToUser(userId, { type: "notification", data });
}

/** `asOfUs`: when the count was read (see readUnreadCount); the browser keeps the newest. */
export function pushUnreadCount(userId: string, count: number, asOfUs?: number) {
	publishToUser(userId, { type: "unread_count", count, ...(asOfUs !== undefined ? { asOfUs } : {}) });
}

