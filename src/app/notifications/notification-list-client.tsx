"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getSafeNotificationActionUrl } from "@/lib/notification/action-url";

type NotificationItem = {
	id: string;
	type: string;
	title: string;
	message: string;
	isRead: boolean;
	actionUrl: string | null;
	createdAt: string;
};

type Props = {
	initialNotifications: NotificationItem[];
	initialUnreadCount: number;
};

const typeIcon: Record<string, string> = {
	command_pending: "📋",
	command_approved: "✅",
	command_rejected: "❌",
	command_completed: "🎉",
	command_failed: "💥",
	download_completed: "📥",
	download_failed: "⚠️",
	server_alert: "🚨",
	system: "🔔",
};

function timeAgo(dateStr: string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return "刚刚";
	if (mins < 60) return `${mins} 分钟前`;
	const hours = Math.floor(mins / 60);
	if (hours < 24) return `${hours} 小时前`;
	const days = Math.floor(hours / 24);
	if (days < 30) return `${days} 天前`;
	return new Date(dateStr).toLocaleDateString("zh-CN");
}

export function NotificationListClient({ initialNotifications, initialUnreadCount }: Props) {
	const [notifications, setNotifications] = useState(initialNotifications);
	const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
	const [error, setError] = useState<string | null>(null);

	const messageFromError = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

	const markAllRead = useCallback(async () => {
		setError(null);
		try {
			await csrfFetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ markAllAsRead: true }) });
			setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
			setUnreadCount(0);
		} catch (err) {
			setError(messageFromError(err, "全部标记已读失败"));
		}
	}, []);

	const markOneRead = useCallback(async (id: string) => {
		setError(null);
		try {
			await csrfFetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notificationId: id }) });
			setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
			setUnreadCount((c) => Math.max(0, c - 1));
		} catch (err) {
			setError(messageFromError(err, "标记通知已读失败"));
		}
	}, []);

	const deleteOne = useCallback(async (id: string) => {
		setError(null);
		try {
			await csrfFetch(`/api/notifications?id=${id}`, { method: "DELETE" });
			setNotifications((prev) => {
				const deleted = prev.find((n) => n.id === id);
				if (deleted && !deleted.isRead) setUnreadCount((c) => Math.max(0, c - 1));
				return prev.filter((n) => n.id !== id);
			});
		} catch (err) {
			setError(messageFromError(err, "删除通知失败"));
		}
	}, []);

	if (notifications.length === 0) {
		return (
			<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
				<div className="text-4xl mb-3">🔔</div>
				<p className="text-sm text-slate-500">暂无通知</p>
			</div>
		);
	}

	return (
		<div className="space-y-3">
			{error && (
				<div role="alert" className="rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
					{error}
				</div>
			)}
			{unreadCount > 0 && (
				<div className="flex justify-end">
					<button onClick={markAllRead} className="text-xs text-cyan-400/80 hover:text-cyan-300 transition">
						全部标记已读
					</button>
				</div>
			)}
			{notifications.map((n) => (
				<article
					key={n.id}
					className={`group rounded-xl border p-4 transition-all duration-150 ${
						n.isRead
							? "border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03]"
							: "border-cyan-400/20 bg-cyan-400/[0.04] hover:bg-cyan-400/[0.06]"
					}`}
				>
					<div className="flex items-start gap-3">
						<span className="text-lg mt-0.5 shrink-0">{typeIcon[n.type] ?? "🔔"}</span>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<h3 className={`text-sm font-medium truncate ${n.isRead ? "text-slate-400" : "text-white"}`}>{n.title}</h3>
								{!n.isRead && <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0" />}
							</div>
							<p className="mt-1 text-xs text-slate-500 leading-relaxed">{n.message}</p>
							<div className="mt-2 flex items-center gap-3 text-[11px]">
								<span className="text-slate-600">{timeAgo(n.createdAt)}</span>
								{n.actionUrl && (
									<Link href={getSafeNotificationActionUrl(n.actionUrl)} className="text-cyan-400/70 hover:text-cyan-300 transition">
										查看详情 →
									</Link>
								)}
								{!n.isRead && (
									<button onClick={() => markOneRead(n.id)} className="text-slate-500 hover:text-slate-300 transition">
										标为已读
									</button>
								)}
								<button onClick={() => deleteOne(n.id)} className="text-slate-600 hover:text-rose-400 transition opacity-0 group-hover:opacity-100">
									删除
								</button>
							</div>
						</div>
					</div>
				</article>
			))}
		</div>
	);
}
