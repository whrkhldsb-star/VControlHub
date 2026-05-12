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
import { verifySessionToken } from "@/lib/auth/session";

/* ── Connection Registry ─────────────────────────────────── */
const userConnections = new Map<string, Set<WebSocket>>();

function addConnection(userId: string, ws: WebSocket) {
	if (!userConnections.has(userId)) userConnections.set(userId, new Set());
	userConnections.get(userId)!.add(ws);
}

function removeConnection(userId: string, ws: WebSocket) {
	const conns = userConnections.get(userId);
	if (conns) {
		conns.delete(ws);
		if (conns.size === 0) userConnections.delete(userId);
	}
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
		if (ws.readyState === WebSocket.OPEN) {
			ws.send(payload);
		}
	}
}

export function broadcastToAll(message: WsMessage) {
	const payload = JSON.stringify(message);
	for (const conns of userConnections.values()) {
		for (const ws of conns) {
			if (ws.readyState === WebSocket.OPEN) ws.send(payload);
		}
	}
}

/* ── WebSocket Server Setup ──────────────────────────────── */
let wss: WebSocketServer | null = null;

export function getWsServer(): WebSocketServer | null {
	return wss;
}

export function setupWebSocketServer(server: import("node:http").Server) {
	if (wss) return; // already initialized

	wss = new WebSocketServer({ noServer: true });

	// Handle HTTP upgrade requests
	server.on("upgrade", (request: IncomingMessage, socket: import("node:stream").Duplex, head: Buffer) => {
		// Only handle /ws path
		const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
		if (url.pathname !== "/ws") {
			socket.destroy();
			return;
		}

		// Authenticate via token query param
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

				wss!.handleUpgrade(request, socket, head, (ws) => {
					wss!.emit("connection", ws, request, session);
				});
			} catch {
				socket.destroy();
			}
		})();
	});

	wss.on("connection", (ws: WebSocket, _req: IncomingMessage, session: SessionPayload) => {
		const userId = session.userId;
		addConnection(userId, ws);

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
			removeConnection(userId, ws);
		});
	});

	console.log("[WS] WebSocket notification server initialized");
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
