/**
 * React hook for WebSocket real-time notifications.
 * Connects to /ws?token=SESSION_TOKEN, auto-reconnects on disconnect.
 */
"use client";

import { useEffect, useRef, useCallback, useState } from "react";

export type WsNotification = {
	id: string;
	title: string;
	message: string;
	actionUrl?: string | null;
	createdAt: string;
};

export type WsMessage =
	| { type: "connected"; userId: string }
	| { type: "notification"; data: WsNotification }
	| { type: "unread_count"; count: number }
	| { type: "download_progress"; data: { taskId: string; progress: number; status: string } }
	| { type: "server_alert"; data: { serverId: string; serverName: string; message: string } }
	| { type: "pong"; ts: number };

type UseWsNotificationsReturn = {
	connected: boolean;
	lastNotification: WsNotification | null;
	unreadCount: number;
	lastDownloadProgress: { taskId: string; progress: number; status: string } | null;
	lastServerAlert: { serverId: string; serverName: string; message: string } | null;
};

/**
 * Get the exact session cookie name from the <meta> tag injected by layout,
 * or fall back to parsing document.cookie for *_session pattern.
 * This avoids the overly broad regex that could match wrong cookies.
 */
function getSessionTokenFromCookie(): string | null {
	// Prefer meta tag if available (set by layout)
	const metaTag = document.querySelector('meta[name="session-cookie-name"]');
	const cookieName = metaTag?.getAttribute("content");

	if (cookieName) {
		// Exact match for the known cookie name
		const exactMatch = document.cookie.match(
			new RegExp(`(?:^|;\\s*)${cookieName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]+)`)
		);
		if (exactMatch) return exactMatch[1]!;
	}

	// Fallback: find a cookie ending with _session
	const fallbackMatch = document.cookie.match(/(?:^|;\s*)(\w+_session)=([^;]+)/);
	if (fallbackMatch) return fallbackMatch[2]!;

	return null;
}

export function useWsNotifications(): UseWsNotificationsReturn {
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const heartbeatRef = useRef<ReturnType<typeof setInterval>>(undefined);
	/** Stable ref to the latest `connect` function — avoids stale closure in onclose */
	const connectRef = useRef<() => void>(() => {});
	const [connected, setConnected] = useState(false);
	const [lastNotification, setLastNotification] = useState<WsNotification | null>(null);
	const [unreadCount, setUnreadCount] = useState(0);
	const [lastDownloadProgress, setLastDownloadProgress] = useState<{ taskId: string; progress: number; status: string } | null>(null);
	const [lastServerAlert, setLastServerAlert] = useState<{ serverId: string; serverName: string; message: string } | null>(null);

	const cleanup = useCallback(() => {
		if (heartbeatRef.current) {
			clearInterval(heartbeatRef.current);
			heartbeatRef.current = undefined;
		}
		if (reconnectTimer.current) {
			clearTimeout(reconnectTimer.current);
			reconnectTimer.current = undefined;
		}
		if (wsRef.current) {
			wsRef.current.onclose = null; // prevent reconnect loop on intentional close
			wsRef.current.close();
			wsRef.current = null;
		}
	}, []);

	const connect = useCallback(() => {
		const token = getSessionTokenFromCookie();
		if (!token) return;

		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

		try {
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				setConnected(true);
				// Start heartbeat — store in ref for proper cleanup
				heartbeatRef.current = setInterval(() => {
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(JSON.stringify({ type: "ping" }));
					}
				}, 30_000);
			};

			ws.onmessage = (event) => {
				try {
					const msg: WsMessage = JSON.parse(event.data);
					switch (msg.type) {
						case "notification":
							setLastNotification(msg.data);
							break;
						case "unread_count":
							setUnreadCount(msg.count);
							break;
						case "download_progress":
							setLastDownloadProgress(msg.data);
							break;
						case "server_alert":
							setLastServerAlert(msg.data);
							break;
					}
				} catch { /* ignore */ }
			};

			ws.onclose = () => {
				setConnected(false);
				// Clear heartbeat on disconnect
				if (heartbeatRef.current) {
					clearInterval(heartbeatRef.current);
					heartbeatRef.current = undefined;
				}
				// Auto-reconnect after 3 seconds via stable ref (avoids stale closure)
				reconnectTimer.current = setTimeout(() => connectRef.current(), 3000);
			};

			ws.onerror = () => {
				ws.close();
			};
		} catch {
			// Fallback: will retry via stable ref
			reconnectTimer.current = setTimeout(() => connectRef.current(), 5000);
		}
	}, []);

	// Keep the ref updated whenever connect changes
	useEffect(() => {
		connectRef.current = connect;
	});

	useEffect(() => {
		connect();
		return cleanup;
	}, [connect, cleanup]);

	return { connected, lastNotification, unreadCount, lastDownloadProgress, lastServerAlert };
}
