"use client";

import { useState, useCallback, memo } from "react";
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

const NotificationRow = memo(function NotificationRow({
	notification: n,
	t,
	onMarkRead,
	onDelete,
}: {
	notification: NotificationItem;
	t: (k: string) => string;
	onMarkRead: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<article
			className={`group rounded-xl border p-4 transition-colors duration-150 focus-within:ring-2 focus-within:ring-[var(--color-action-ring)] light:focus-within:ring-[var(--color-action-ring)] ${
				n.isRead
					? "border-[var(--border)] bg-[var(--surface)]/[0.04] hover:bg-[var(--surface)]/[0.04] light:hover:bg-[var(--surface-hover)]"
					: "border-[var(--color-action-border)]/20 bg-[var(--color-action-bg)]/[0.04] hover:bg-[var(--color-action-bg)]/[0.10] light:border-[var(--color-action-border)]/30 light:bg-[var(--color-action-bg)] light:hover:bg-[var(--color-action-bg)]/70"
			}`}
		>
			<div className="flex items-start gap-3">
				<span className="text-lg mt-0.5 shrink-0" aria-hidden="true">{typeIcon[n.type] ?? "🔔"}</span>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 min-w-0">
						<h3 className={`text-sm font-medium truncate ${n.isRead ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`} title={n.title}>{n.title}</h3>
						{!n.isRead && <div className="h-1.5 w-1.5 rounded-full bg-[var(--color-action-bg)] shrink-0 light:bg-[var(--color-action-strong)]" aria-label={t("notificationsPage.unreadBadge")} />}
					</div>
					<p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">{n.message}</p>
					<div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
						<span className="text-[var(--text-muted)]">{timeAgo(n.createdAt, t)}</span>
						{n.actionUrl && (
							<Link href={getSafeNotificationActionUrl(n.actionUrl)} className="rounded-lg px-1 py-0.5 text-[var(--color-action)]/70 transition hover:text-[var(--color-action)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-action-ring)] light:hover:text-[var(--color-action-strong)] light:focus-visible:ring-[var(--color-action-ring)]">
								{t("notificationsPage.action.view")}
							</Link>
						)}
						{!n.isRead && (
							<button onClick={() => onMarkRead(n.id)} className="rounded-lg px-1 py-0.5 text-[var(--text-muted)] transition hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-action-ring)] light:hover:text-[var(--text-primary)] light:focus-visible:ring-[var(--color-action-ring)]">
								{t("notificationsPage.action.markOne")}
							</button>
						)}
						<button onClick={() => onDelete(n.id)} className="rounded-lg px-1 py-0.5 text-[var(--text-muted)] opacity-100 transition hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger-border)] hover:text-[var(--danger)] focus-visible:ring-[var(--danger-border)] sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
							{t("notificationsPage.action.delete")}
						</button>
					</div>
				</div>
			</div>
		</article>
	);
}, (prev, next) => {
	const p = prev.notification, n = next.notification;
	return (
		p.id === n.id &&
		p.type === n.type &&
		p.title === n.title &&
		p.message === n.message &&
		p.isRead === n.isRead &&
		p.actionUrl === n.actionUrl &&
		p.createdAt === n.createdAt &&
		prev.t === next.t &&
		prev.onMarkRead === next.onMarkRead &&
		prev.onDelete === next.onDelete
	);
});

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
				<div role="alert" data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-3 py-2 text-xs text-[var(--danger)]">
					{error}
				</div>
			)}
			{unreadCount > 0 && (
				<div className="flex justify-end">
					<button onClick={markAllRead} className="rounded-lg px-1.5 py-1 text-xs text-[var(--color-action)]/80 transition hover:text-[var(--color-action)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-action-ring)] light:hover:text-[var(--color-action-strong)] light:focus-visible:ring-[var(--color-action-ring)]">
						{t("notificationsPage.action.markAll")}
					</button>
				</div>
			)}
			{notifications.map((n) => (
				<NotificationRow
					key={n.id}
					notification={n}
					t={t}
					onMarkRead={markOneRead}
					onDelete={deleteOne}
				/>
			))}
		</div>
	);
}
