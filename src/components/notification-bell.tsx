"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState, useCallback, useRef, useLayoutEffect } from "react";
import { useWsNotifications } from "@/lib/ws/use-ws-notifications";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getSafeNotificationActionUrl } from "@/lib/notification/action-url";
import { getRefreshIntervalFromStorage, getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";

/* ── Notification bell with real-time WebSocket push ──────── */

export function NotificationBell() {
	const { t } = useI18n();
	const [isOpen, setIsOpen] = useState(false);
	const [notifications, setNotifications] = useState<Array<{
		id: string; type: string; title: string; message: string; isRead: boolean; actionUrl: string | null; createdAt: string;
	}>>([]);
	const [feedback, setFeedback] = useState<{ type: "error" | "info"; message: string } | null>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const popoverRef = useRef<HTMLDivElement>(null);
	const [popoverPos, setPopoverPos] = useState<{ left: number; bottom: number; maxHeight: number } | null>(null);

	// Position the portal popover relative to the bell button, clamped to viewport
	const updatePopoverPosition = useCallback(() => {
		const btn = buttonRef.current;
		if (!btn) return;
		const rect = btn.getBoundingClientRect();
		const width = 320; // w-80
		const gap = 8;
		const margin = 8;
		// Prefer opening upward from the button (bell lives at sidebar bottom)
		const bottom = window.innerHeight - rect.top + gap;
		let left = rect.left;
		if (left + width + margin > window.innerWidth) {
			left = window.innerWidth - width - margin;
		}
		if (left < margin) left = margin;
		const maxHeight = Math.max(160, rect.top - gap - margin);
		setPopoverPos({ left, bottom, maxHeight });
	}, []);

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
			setFeedback({ type: "error", message: err instanceof Error ? err.message : t("notificationBell.error.load") });
		}
	}, [t, wsConnected]);

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
				title: t("notificationBell.serverAlertTitle").replace("{name}", lastServerAlert.serverName),
				message: lastServerAlert.message,
				isRead: false,
				actionUrl: "/servers",
				createdAt: new Date().toISOString(),
			}, ...prev].slice(0, 50));
		}
	}, [lastServerAlert, t]);

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			const target = e.target as Node;
			const inTrigger = panelRef.current?.contains(target);
			const inPopover = popoverRef.current?.contains(target);
			if (!inTrigger && !inPopover) {
				setIsOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, []);

	// Recompute portal position when open, and on resize/scroll
	useLayoutEffect(() => {
		if (!isOpen) return;
		updatePopoverPosition();
		const onChange = () => updatePopoverPosition();
		window.addEventListener("resize", onChange);
		window.addEventListener("scroll", onChange, true);
		return () => {
			window.removeEventListener("resize", onChange);
			window.removeEventListener("scroll", onChange, true);
		};
	}, [isOpen, updatePopoverPosition]);

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
			setFeedback({ type: "error", message: err instanceof Error ? err.message : t("notificationBell.error.markAll") });
		}
	};

	const notificationLabel = t("notificationBell.title");
	const realtimeLabel = t("notificationBell.realtime");
	const manualLabel = t("notificationBell.manual");
	const pollingPrefix = t("notificationBell.polling");
	const markAllReadLabel = t("notificationBell.markAllRead");
	const emptyLabel = t("notificationBell.empty");
	const recentListLabel = t("notificationBell.recentList");
	const viewAllLabel = t("notificationBell.viewAll");

	return (
		<div className="relative" ref={panelRef}>
			<button
				ref={buttonRef}
				onClick={togglePanel}
				className="relative flex items-center justify-center w-11 h-11 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-elevated)] transition"
				aria-label={notificationLabel}
				aria-haspopup="dialog"
				aria-expanded={isOpen}
				aria-controls="notification-popover"
			>
				<svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
				</svg>
				{effectiveUnread > 0 && (
					<span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white animate-pulse">
						{effectiveUnread > 99 ? "99+" : effectiveUnread}
					</span>
				)}
				{/* WS connection indicator */}
				{wsConnected && (
					<span className="absolute bottom-0 right-0 h-1.5 w-1.5 rounded-full bg-emerald-400" title={t("notificationBell.liveConnection")} />
				)}
			</button>

			{isOpen && typeof document !== "undefined" && createPortal(
				<div
					ref={popoverRef}
					id="notification-popover"
					role="dialog"
					aria-modal="false"
					aria-labelledby="notification-popover-title"
					style={{
						position: "fixed",
						left: popoverPos ? `${popoverPos.left}px` : "0px",
						bottom: popoverPos ? `${popoverPos.bottom}px` : "auto",
						maxHeight: popoverPos ? `${popoverPos.maxHeight}px` : "60vh",
						visibility: popoverPos ? "visible" : "hidden",
					}}
					className="w-80 rounded-xl border border-[var(--border)] bg-[var(--modal-bg)] backdrop-blur-xl shadow-2xl z-[9999] overflow-y-auto"
					>
					<div className="sticky top-0 bg-[var(--modal-bg)] backdrop-blur border-b border-[var(--border)] px-4 py-3 flex items-center justify-between">
						<span id="notification-popover-title" className="text-sm font-medium text-[var(--text-primary)]">{notificationLabel}</span>
						<div className="flex items-center gap-2">
							{wsConnected ? (
								<span className="text-[10px] text-emerald-600 dark:text-emerald-400/70">{realtimeLabel}</span>
							) : refreshIntervalSeconds <= 0 ? (
								<span className="text-[10px] text-[var(--text-muted)]">{manualLabel}</span>
							) : (
								<span className="text-[10px] text-[var(--text-muted)]">{pollingPrefix} {getRefreshIntervalLabel(refreshIntervalSeconds)}</span>
							)}
							{effectiveUnread > 0 && (
								<button onClick={markAllRead} className="text-[11px] text-[var(--color-action)] hover:opacity-80 transition">
									{markAllReadLabel}
								</button>
							)}
						</div>
					</div>
					{feedback && (
						<div role="alert" data-tone="rose" className="border-b border-rose-400/10 px-4 py-2 text-xs text-rose-200">
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
										className={`block px-4 py-3 hover:bg-[var(--surface-elevated)] transition ${n.isRead ? "opacity-70" : ""}`}
									>
										<div className="flex items-center gap-2">
											{!n.isRead && <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-action-bg)] shrink-0" />}
											<span className={`text-xs font-medium truncate ${n.isRead ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)]"}`}>{n.title}</span>
											</div>
											<p className="mt-1 text-[11px] text-[var(--text-muted)] truncate">{n.message}</p>
									</Link>
								</li>
							))}
						</ul>
					) : null}
					<div className="sticky bottom-0 border-t border-[var(--border)] bg-[var(--modal-bg)]">
						<Link href="/notifications" className="block px-4 py-2.5 text-center text-xs text-[var(--color-action)]/80 hover:text-[var(--color-action)] transition light:hover:text-[var(--color-action-strong)]">
							{viewAllLabel}
						</Link>
					</div>
				</div>,
				document.body
			)}
		</div>
	);
}
