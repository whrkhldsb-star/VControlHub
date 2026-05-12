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

export function useWsNotifications(): UseWsNotificationsReturn {
	const wsRef = useRef<WebSocket | null>(null);
	const reconnectTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
	const [connected, setConnected] = useState(false);
	const [lastNotification, setLastNotification] = useState<WsNotification | null>(null);
	const [unreadCount, setUnreadCount] = useState(0);
	const [lastDownloadProgress, setLastDownloadProgress] = useState<{ taskId: string; progress: number; status: string } | null>(null);
	const [lastServerAlert, setLastServerAlert] = useState<{ serverId: string; serverName: string; message: string } | null>(null);

	const connect = useCallback(() => {
		// Get session token from cookie
		const cookieMatch = document.cookie.match(/(?:^|;\s*)\w+_session=([^;]+)/);
		if (!cookieMatch) return;

		const token = cookieMatch[1];
		const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
		const wsUrl = `${protocol}//${window.location.host}/ws?token=${encodeURIComponent(token)}`;

		try {
			const ws = new WebSocket(wsUrl);
			wsRef.current = ws;

			ws.onopen = () => {
				setConnected(true);
				// Start heartbeat
				const heartbeat = setInterval(() => {
					if (ws.readyState === WebSocket.OPEN) {
						ws.send(JSON.stringify({ type: "ping" }));
					} else {
						clearInterval(heartbeat);
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
				// Auto-reconnect after 3 seconds
				reconnectTimer.current = setTimeout(connect, 3000);
			};

			ws.onerror = () => {
				ws.close();
			};
		} catch {
			// Fallback: will retry
			reconnectTimer.current = setTimeout(connect, 5000);
		}
	}, []);

	useEffect(() => {
		connect();
		return () => {
			if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
			if (wsRef.current) wsRef.current.close();
		};
	}, [connect]);

	return { connected, lastNotification, unreadCount, lastDownloadProgress, lastServerAlert };
}
