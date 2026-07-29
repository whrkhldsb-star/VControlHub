"use client";

import { useState, useCallback, memo, type ReactNode } from "react";
import Link from "next/link";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getSafeNotificationActionUrl } from "@/lib/notification/action-url";
import { EmptyState } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import type { Locale } from "@/lib/i18n/translations";
import { Check, X, AlertTriangle, ClipboardList, Download, Server, Bell } from "@/components/icons";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";

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
	initialNow: string;
};

const typeIcon: Record<string, ReactNode> = {
	command_pending: <ClipboardList size={18} aria-hidden="true" />,
	command_approved: <Check size={18} aria-hidden="true" />,
	command_rejected: <X size={18} aria-hidden="true" />,
	command_completed: <Check size={18} aria-hidden="true" />,
	command_failed: <X size={18} aria-hidden="true" />,
	download_completed: <Download size={18} aria-hidden="true" />,
	download_failed: <AlertTriangle size={18} aria-hidden="true" />,
	server_alert: <Server size={18} aria-hidden="true" />,
	system: <Bell size={18} aria-hidden="true" />,
};

function timeAgo(dateStr: string, nowMs: number, t: (k: string, vars?: Record<string, string | number>) => string, locale: Locale): string {
	const diff = nowMs - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return t("notificationsPage.time.justNow");
	if (mins < 60) return t("notificationsPage.time.minutesAgo", { count: mins });
	const hours = Math.floor(mins / 60);
	if (hours < 24) return t("notificationsPage.time.hoursAgo", { count: hours });
	const days = Math.floor(hours / 24);
	if (days < 30) return t("notificationsPage.time.daysAgo", { count: days });
	return new Date(dateStr).toLocaleDateString(toDateLocale(locale));
}

const NotificationRow = memo(function NotificationRow({
	notification: n,
	t,
	locale,
	nowMs,
	onMarkRead,
	onDelete,
}: {
	notification: NotificationItem;
	t: (k: string, vars?: Record<string, string | number>) => string;
	locale: Locale;
	nowMs: number;
	onMarkRead: (id: string) => void;
	onDelete: (id: string) => void;
}) {
	return (
		<article
			className={`group rounded-2xl border p-4 transition-colors duration-150 focus-within:ring-2 focus-within:ring-[var(--accent)]/40 ${
				n.isRead
					? "border-[var(--border)] bg-[var(--surface)] hover:bg-[var(--surface-hover)]"
					: "border-[var(--accent-border)] bg-[var(--accent-bg)] hover:bg-[color-mix(in_srgb,var(--accent-bg)_80%,var(--surface))]"
			}`}
		>
			<div className="flex items-start gap-3">
				<span className="text-lg mt-0.5 shrink-0" aria-hidden="true">{typeIcon[n.type] ?? <Bell size={18} aria-hidden="true" />}</span>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 min-w-0">
						<h3 className={`text-sm font-medium truncate ${n.isRead ? "text-[var(--text-muted)]" : "text-[var(--text-primary)]"}`} title={n.title}>{n.title}</h3>
						{!n.isRead && <div className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-label={t("notificationsPage.unreadBadge")} />}
					</div>
					<p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">{n.message}</p>
					<div className="mt-2 flex flex-wrap items-center gap-3 text-[11px]">
						<span className="text-[var(--text-muted)]">{timeAgo(n.createdAt, nowMs, t, locale)}</span>
						{n.actionUrl && (
							<Link href={getSafeNotificationActionUrl(n.actionUrl)} className="rounded-lg px-1 py-0.5 font-medium text-[var(--accent)] transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
								{t("notificationsPage.action.view")}
							</Link>
						)}
						{!n.isRead && (
							<button type="button" onClick={() => onMarkRead(n.id)} className="rounded-lg px-1 py-0.5 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
								{t("notificationsPage.action.markOne")}
							</button>
						)}
						<button type="button" onClick={() => onDelete(n.id)} className="rounded-lg px-1 py-0.5 text-[var(--text-muted)] transition hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--danger-border)] light:hover:text-[var(--danger)]" aria-label={t("notificationsPage.action.delete")}>
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
		prev.locale === next.locale &&
		prev.nowMs === next.nowMs &&
		prev.t === next.t &&
		prev.onMarkRead === next.onMarkRead &&
		prev.onDelete === next.onDelete
	);
});

export function NotificationListClient({ initialNotifications, initialUnreadCount, initialNow }: Props) {
	const { t, locale } = useI18n();
	const parsedNow = Date.parse(initialNow);
	const nowMs = Number.isFinite(parsedNow) ? parsedNow : 0;
	const [notifications, setNotifications] = useState(initialNotifications);
	const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
	const [error, setError] = useState<string | null>(null);
	const [hasMore, setHasMore] = useState(initialNotifications.length >= 50);
	const [loadingMore, setLoadingMore] = useState(false);

	const messageFromError = (err: unknown, fallback: string) => (getErrorMessage(err, fallback));

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
			// Only decrement when this id was still unread in local state (avoids double-count under concurrent markAll/markOne).
			let wasUnread = false;
			setNotifications((prev) =>
				prev.map((n) => {
					if (n.id !== id) return n;
					wasUnread = !n.isRead;
					return { ...n, isRead: true };
				}),
			);
			if (wasUnread) {
				setUnreadCount((c) => Math.max(0, c - 1));
			}
		} catch (err) {
			setError(messageFromError(err, t("notificationsPage.error.markOneFailed")));
		}
	}, [t]);

	const deleteOne = useCallback(async (id: string) => {
		setError(null);
		try {
			await csrfFetch(`/api/notifications?id=${id}`, { method: "DELETE" });
			const deleted = notifications.find((n) => n.id === id);
			setNotifications((prev) => prev.filter((n) => n.id !== id));
			if (deleted && !deleted.isRead) {
				setUnreadCount((c) => Math.max(0, c - 1));
			}
		} catch (err) {
			setError(messageFromError(err, t("notificationsPage.error.deleteFailed")));
		}
	}, [notifications, t]);

	const loadMore = useCallback(async () => {
		if (loadingMore || !hasMore) return;
		setLoadingMore(true);
		setError(null);
		try {
			const data = await csrfFetch<{
				notifications?: NotificationItem[];
				hasMore?: boolean;
			}>(`/api/notifications?limit=50&offset=${notifications.length}`);
			const batch = (data.notifications ?? []).map((n) => ({
				...n,
				createdAt: typeof n.createdAt === "string" ? n.createdAt : String(n.createdAt),
			}));
			setNotifications((prev) => {
				const seen = new Set(prev.map((x) => x.id));
				return [...prev, ...batch.filter((x) => !seen.has(x.id))];
			});
			setHasMore(Boolean(data.hasMore));
		} catch (err) {
			setError(messageFromError(err, t("notificationsPage.error.loadMoreFailed")));
		} finally {
			setLoadingMore(false);
		}
	}, [hasMore, loadingMore, notifications.length, t]);

	if (notifications.length === 0) {
		return (
			<EmptyState icon={<Bell size={36} className="text-[var(--text-muted)]" aria-hidden="true" />} variant="boxed">
				{t("notificationsPage.empty")}
			</EmptyState>
		);
	}

	return (
		<div className="space-y-3">
			{error && <Notice tone="danger" compact onDismiss={() => setError(null)} dismissLabel={t("common.close")}>{error}</Notice>}
			{unreadCount > 0 && (
				<div className="flex justify-end">
					<ActionButton variant="ghost" onClick={markAllRead} className="!px-2 !py-1 !text-xs">
						{t("notificationsPage.action.markAll")}
					</ActionButton>
				</div>
			)}
			{notifications.map((n) => (
				<NotificationRow
					key={n.id}
					notification={n}
					t={t}
					locale={locale}
					nowMs={nowMs}
					onMarkRead={markOneRead}
					onDelete={deleteOne}
				/>
			))}
			{hasMore ? (
				<div className="flex justify-center pt-2">
					<ActionButton variant="secondary"
						onClick={() => void loadMore()}
						disabled={loadingMore}
					
						className="!px-3 !py-1.5 !text-xs disabled:opacity-50"
					>
						{loadingMore ? t("notificationsPage.loadingMore") : t("notificationsPage.loadMore")}
					</ActionButton>
				</div>
			) : null}
		</div>
	);
}
