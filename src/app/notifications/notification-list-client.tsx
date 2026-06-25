"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getSafeNotificationActionUrl } from "@/lib/notification/action-url";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";
import type { Locale } from "@/lib/i18n/translations";

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
	locale?: Locale;
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

function timeAgo(dateStr: string, t: (k: string) => string): string {
	const diff = Date.now() - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return t("notificationsPage.time.justNow");
	if (mins < 60) return t("notificationsPage.time.minutesAgo").replace("{count}", String(mins));
	const hours = Math.floor(mins / 60);
	if (hours < 24) return t("notificationsPage.time.hoursAgo").replace("{count}", String(hours));
	const days = Math.floor(hours / 24);
	if (days < 30) return t("notificationsPage.time.daysAgo").replace("{count}", String(days));
	return new Date(dateStr).toLocaleDateString("en-US");
}

export function NotificationListClient({ initialNotifications, initialUnreadCount }: Props) {
	const { t } = useI18n();
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
			setError(messageFromError(err, t("notificationsPage.error.markAllFailed")));
		}
	}, [t]);

	const markOneRead = useCallback(async (id: string) => {
		setError(null);
		try {
			await csrfFetch("/api/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notificationId: id }) });
			setNotifications((prev) => prev.map((n) => (n.id === id ? ({ ...n, isRead: true }) : n)));
			setUnreadCount((c) => Math.max(0, c - 1));
		} catch (err) {
			setError(messageFromError(err, t("notificationsPage.error.markOneFailed")));
		}
	}, [t]);

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
			setError(messageFromError(err, t("notificationsPage.error.deleteFailed")));
		}
	}, [t]);

	if (notifications.length === 0) {
		return (
			<EmptyState icon="🔔" variant="boxed">
				{t("notificationsPage.empty")}
			</EmptyState>
		);
	}

	return (
		<div className="space-y-3">
			{error && (
				<div role="alert" data-tone="rose" className="rounded-lg border border-rose-400/20 px-3 py-2 text-xs text-rose-200">
					{error}
				</div>
			)}
			{unreadCount > 0 && (
				<div className="flex justify-end">
					<button onClick={markAllRead} className="rounded-lg px-1.5 py-1 text-xs text-cyan-400/80 transition hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 light:hover:text-cyan-800 light:focus-visible:ring-cyan-600">
						{t("notificationsPage.action.markAll")}
					</button>
				</div>
			)}
			{notifications.map((n) => (
				<article
					key={n.id}
					className={`group rounded-xl border p-4 transition-colors duration-150 focus-within:ring-2 focus-within:ring-cyan-300/60 light:focus-within:ring-cyan-600/50 ${
						n.isRead
							? "border-white/[0.04] bg-white/[0.01] hover:bg-white/[0.03] light:hover:bg-slate-50"
							: "border-cyan-400/20 bg-cyan-400/[0.04] hover:bg-cyan-400/[0.06] light:border-cyan-600/30 light:bg-cyan-50 light:hover:bg-cyan-100/70"
					}`}
				>
					<div className="flex items-start gap-3">
						<span className="text-lg mt-0.5 shrink-0" aria-hidden="true">{typeIcon[n.type] ?? "🔔"}</span>
						<div className="flex-1 min-w-0">
							<div className="flex items-center gap-2">
								<h3 className={`text-sm font-medium truncate ${n.isRead ? "text-slate-400" : "text-white"}`}>{n.title}</h3>
								{!n.isRead && <div className="h-1.5 w-1.5 rounded-full bg-cyan-400 shrink-0 light:bg-cyan-600" aria-label={t("notificationsPage.unreadBadge")} />}
							</div>
							<p className="mt-1 text-xs text-slate-500 leading-relaxed">{n.message}</p>
							<div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
								<span className="text-slate-600">{timeAgo(n.createdAt, t)}</span>
								{n.actionUrl && (
									<Link href={getSafeNotificationActionUrl(n.actionUrl)} className="rounded-lg px-1 py-0.5 text-cyan-400/70 transition hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 light:hover:text-cyan-800 light:focus-visible:ring-cyan-600">
										{t("notificationsPage.action.view")}
									</Link>
								)}
								{!n.isRead && (
									<button onClick={() => markOneRead(n.id)} className="rounded-lg px-1 py-0.5 text-slate-500 transition hover:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 light:hover:text-slate-900 light:focus-visible:ring-cyan-600">
										{t("notificationsPage.action.markOne")}
									</button>
								)}
								<button onClick={() => deleteOne(n.id)} className="rounded-lg px-1 py-0.5 text-slate-600 opacity-100 transition hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 light:hover:text-rose-700 light:focus-visible:ring-rose-600 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
									{t("notificationsPage.action.delete")}
								</button>
							</div>
						</div>
					</div>
				</article>
			))}
		</div>
	);
}
