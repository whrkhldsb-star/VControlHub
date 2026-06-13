"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useRef } from "react";
import { useWsNotifications } from "@/lib/ws/use-ws-notifications";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getSafeNotificationActionUrl } from "@/lib/notification/action-url";
import { getRefreshIntervalFromStorage, getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";

/* ── Notification bell with real-time WebSocket push ──────── */

export function NotificationBell() {
	const { locale } = useI18n();
	const [isOpen, setIsOpen] = useState(false);
	const [notifications, setNotifications] = useState<Array<{
		id: string; type: string; title: string; message: string; isRead: boolean; actionUrl: string | null; createdAt: string;
	}>>([]);
	const [feedback, setFeedback] = useState<{ type: "error" | "info"; message: string } | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	// WebSocket real-time updates
	const { connected: wsConnected, lastNotification, unreadCount, lastServerAlert } = useWsNotifications();

	// Fallback: poll if WS not connected
	const [polledUnread, setPolledUnread] = useState(0);
	const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(() =>
		typeof window === "undefined" ? 30 : getRefreshIntervalFromStorage(window.localStorage, 30),
	);
	const effectiveUnread = wsConnected ? unreadCount : polledUnread;

	const fetchUnread = useCallback(async () => {
		if (wsConnected) return; // WS handles it
		try {
			const data = await csrfFetch("/api/notifications");
			setPolledUnread(data.unreadCount ?? 0);
		} catch { /* ignore */ }
	}, [wsConnected]);

	const fetchList = useCallback(async () => {
		setFeedback(null);
		try {
			const data = await csrfFetch("/api/notifications");
			setNotifications(data.notifications ?? []);
			if (!wsConnected) setPolledUnread(data.unreadCount ?? 0);
		} catch (err) {
			setNotifications([]);
			setFeedback({ type: "error", message: err instanceof Error ? err.message : (locale === "zh" ? "通知列表加载失败" : "Failed to load notifications") });
		}
	}, [locale, wsConnected]);

	// Poll fallback when WS not connected
	useEffect(() => {
		const onStorage = () => setRefreshIntervalSeconds(getRefreshIntervalFromStorage(window.localStorage, 30));
		window.addEventListener("storage", onStorage);
		window.addEventListener("vps-preferences-updated", onStorage);
		return () => {
			window.removeEventListener("storage", onStorage);
			window.removeEventListener("vps-preferences-updated", onStorage);
		};
	}, []);

	useEffect(() => {
		if (wsConnected || refreshIntervalSeconds <= 0) return;
		const timer = window.setTimeout(() => { void fetchUnread(); }, 0);
		const interval = setInterval(fetchUnread, refreshIntervalSeconds * 1000);
		return () => { window.clearTimeout(timer); clearInterval(interval); };
	}, [fetchUnread, wsConnected, refreshIntervalSeconds]);

	// Toast effect when new notification arrives via WS
	useEffect(() => {
		if (lastNotification) {
			// Prepend to local list

			setNotifications((prev) => [{
				id: lastNotification.id,
				type: "system",
				title: lastNotification.title,
				message: lastNotification.message,
				isRead: false,
				actionUrl: lastNotification.actionUrl ?? null,
				createdAt: lastNotification.createdAt,
			}, ...prev].slice(0, 50));
		}
	}, [lastNotification]);

	// Toast for server alerts

	useEffect(() => {
		if (lastServerAlert) {
			setNotifications((prev) => [{
				id: `alert-${Date.now()}`,
				type: "server_alert",
				title: `服务器告警：${lastServerAlert.serverName}`,
				message: lastServerAlert.message,
				isRead: false,
				actionUrl: "/servers",
				createdAt: new Date().toISOString(),
			}, ...prev].slice(0, 50));
		}
	}, [lastServerAlert]);

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, []);

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsOpen(false);
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, []);

	const togglePanel = async () => {
		if (!isOpen) await fetchList();
		setIsOpen(!isOpen);
	};

	const markAllRead = async () => {
		setFeedback(null);
		try {
			await csrfFetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markAllAsRead: true }) });
			if (wsConnected) { /* WS will update count */ }
			else { setPolledUnread(0); }
			setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
		} catch (err) {
			setFeedback({ type: "error", message: err instanceof Error ? err.message : (locale === "zh" ? "通知标记已读失败" : "Failed to mark notifications read") });
		}
	};

	const notificationLabel = locale === "zh" ? "通知" : "Notifications";
	const realtimeLabel = locale === "zh" ? "实时" : "Live";
	const manualLabel = locale === "zh" ? "手动" : "Manual";
	const pollingPrefix = locale === "zh" ? "轮询" : "Polling";
	const markAllReadLabel = locale === "zh" ? "全部已读" : "Mark all read";
	const emptyLabel = locale === "zh" ? "暂无通知" : "No notifications";
	const recentListLabel = locale === "zh" ? "最近通知" : "Recent notifications";
	const viewAllLabel = locale === "zh" ? "查看全部通知 →" : "View all notifications →";

	return (
		<div className="relative" ref={panelRef}>
			<button
				onClick={togglePanel}
				className="relative flex items-center justify-center w-8 h-8 rounded-lg text-[var(--text-secondary)] hover:text-slate-200 light:hover:text-slate-800 hover:bg-white/[0.06] transition"
				aria-label={notificationLabel}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				aria-controls="notification-popover"
			>
				<svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
				</svg>
				{effectiveUnread > 0 && (
					<span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white animate-pulse">
						{effectiveUnread > 99 ? "99+" : effectiveUnread}
					</span>
				)}
				{/* WS connection indicator */}
				{wsConnected && (
					<span className="absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full bg-emerald-400" title={locale === "zh" ? "实时连接" : "Live connection"} />
				)}
			</button>

			{isOpen && (
				<div
					id="notification-popover"
					role="dialog"
					aria-modal="false"
					aria-labelledby="notification-popover-title"
					className="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-white/[0.12] bg-slate-950/98 backdrop-blur-xl shadow-2xl z-50 max-h-[60vh] overflow-y-auto"
				>
					<div className="sticky top-0 bg-slate-950/95 backdrop-blur border-b border-white/[0.06] px-4 py-3 flex items-center justify-between light:bg-white/95">
						<span id="notification-popover-title" className="text-sm font-medium text-white">{notificationLabel}</span>
						<div className="flex items-center gap-2">
							{wsConnected ? (
								<span className="text-[10px] text-emerald-400/70">{realtimeLabel}</span>
							) : refreshIntervalSeconds <= 0 ? (
								<span className="text-[10px] text-slate-500">{manualLabel}</span>
							) : (
								<span className="text-[10px] text-slate-500">{pollingPrefix} {getRefreshIntervalLabel(refreshIntervalSeconds)}</span>
							)}
							{effectiveUnread > 0 && (
								<button onClick={markAllRead} className="text-[11px] text-cyan-400/80 hover:text-cyan-300 transition">
									{markAllReadLabel}
								</button>
							)}
						</div>
					</div>
					{feedback && (
						<div role="alert" className="border-b border-rose-400/10 bg-rose-500/10 px-4 py-2 text-xs text-rose-200">
							{feedback.message}
						</div>
					)}
					{notifications.length === 0 && !feedback ? (
						<div className="p-6 text-center text-xs text-[var(--text-secondary)]">{emptyLabel}</div>
					) : notifications.length > 0 ? (
						<ul className="divide-y divide-white/[0.04] light:divide-slate-200" aria-label={recentListLabel}>
							{notifications.slice(0, 10).map((n) => (
								<li key={n.id}>
									<Link
										href={getSafeNotificationActionUrl(n.actionUrl)}
										className={`block px-4 py-3 hover:bg-white/[0.04] transition light:hover:bg-slate-100 ${n.isRead ? "opacity-70" : ""}`}
									>
										<div className="flex items-center gap-2">
											{!n.isRead && <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />}
											<span className={`text-xs font-medium truncate ${n.isRead ? "text-[var(--text-secondary)]" : "text-white"}`}>{n.title}</span>
										</div>
										<p className="mt-1 text-[11px] text-slate-500 truncate">{n.message}</p>
									</Link>
								</li>
							))}
						</ul>
					) : null}
					<div className="sticky bottom-0 border-t border-white/[0.06] bg-slate-950/95 light:bg-white/95">
						<Link href="/notifications" className="block px-4 py-2.5 text-center text-xs text-cyan-400/80 hover:text-cyan-300 transition light:hover:text-cyan-800">
							{viewAllLabel}
						</Link>
					</div>
				</div>
			)}
		</div>
	);
}
