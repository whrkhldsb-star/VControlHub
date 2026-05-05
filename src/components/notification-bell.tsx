"use client";

import { useEffect, useState, useCallback, useRef } from "react";

/* ── Notification bell with unread badge ──────────────────── */

export function NotificationBell() {
	const [unreadCount, setUnreadCount] = useState(0);
	const [isOpen, setIsOpen] = useState(false);
	const [notifications, setNotifications] = useState<Array<{
		id: string; type: string; title: string; message: string; isRead: boolean; actionUrl: string | null; createdAt: string;
	}>>([]);
	const panelRef = useRef<HTMLDivElement>(null);

	const fetchUnread = useCallback(async () => {
		try {
			const res = await fetch("/api/notifications");
			if (res.ok) {
				const data = await res.json();
				setUnreadCount(data.unreadCount ?? 0);
			}
		} catch { /* ignore */ }
	}, []);

	const fetchList = useCallback(async () => {
		try {
			const res = await fetch("/api/notifications");
			if (res.ok) {
				const data = await res.json();
				setNotifications(data.notifications ?? []);
				setUnreadCount(data.unreadCount ?? 0);
			}
		} catch { /* ignore */ }
	}, []);

	useEffect(() => {
		const timer = window.setTimeout(() => { void fetchUnread(); }, 0);
		const interval = setInterval(fetchUnread, 30_000);
		return () => {
			window.clearTimeout(timer);
			clearInterval(interval);
		};
	}, [fetchUnread]);

	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
				setIsOpen(false);
			}
		};
		document.addEventListener("mousedown", handleClick);
		return () => document.removeEventListener("mousedown", handleClick);
	}, []);

	const togglePanel = async () => {
		if (!isOpen) await fetchList();
		setIsOpen(!isOpen);
	};

	const markAllRead = async () => {
		await fetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markAllAsRead: true }) });
		setUnreadCount(0);
		setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
	};

	return (
		<div className="relative" ref={panelRef}>
			<button
				onClick={togglePanel}
				className="relative flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-white/[0.06] transition"
				aria-label="通知"
			>
				<svg className="w-[18px] h-[18px]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
				</svg>
				{unreadCount > 0 && (
					<span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
						{unreadCount > 99 ? "99+" : unreadCount}
					</span>
				)}
			</button>

			{isOpen && (
				<div className="absolute bottom-full left-0 mb-2 w-80 rounded-xl border border-white/[0.08] bg-slate-950/95 backdrop-blur-xl shadow-2xl z-50 max-h-[60vh] overflow-y-auto">
					<div className="sticky top-0 bg-slate-950/90 backdrop-blur border-b border-white/[0.06] px-4 py-3 flex items-center justify-between">
						<span className="text-sm font-medium text-white">通知</span>
						{unreadCount > 0 && (
							<button onClick={markAllRead} className="text-[11px] text-cyan-400/80 hover:text-cyan-300 transition">
								全部已读
							</button>
						)}
					</div>
					{notifications.length === 0 ? (
						<div className="p-6 text-center text-xs text-slate-500">暂无通知</div>
					) : (
						<div className="divide-y divide-white/[0.04]">
							{notifications.slice(0, 10).map((n) => (
								<a
									key={n.id}
									href={n.actionUrl ?? "/notifications"}
									className={`block px-4 py-3 hover:bg-white/[0.04] transition ${n.isRead ? "opacity-60" : ""}`}
								>
									<div className="flex items-center gap-2">
										{!n.isRead && <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />}
										<span className={`text-xs font-medium truncate ${n.isRead ? "text-slate-500" : "text-white"}`}>{n.title}</span>
									</div>
									<p className="mt-1 text-[11px] text-slate-600 truncate">{n.message}</p>
								</a>
							))}
						</div>
					)}
					<div className="sticky bottom-0 border-t border-white/[0.06] bg-slate-950/90">
						<a href="/notifications" className="block px-4 py-2.5 text-center text-xs text-cyan-400/80 hover:text-cyan-300 transition">
							查看全部通知 →
						</a>
					</div>
				</div>
			)}
		</div>
	);
}
