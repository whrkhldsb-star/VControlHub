"use client";

import { useState, useCallback, memo, type ReactNode } from "react";
import Link from "next/link";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getSafeNotificationActionUrl } from "@/lib/notification/action-url";
import { EmptyState, ToggleChip } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import type { Locale } from "@/lib/i18n/translations";
import { AlertTriangle, Bell, Check, ChevronRight, ClipboardList, Download, Server, X } from "@/components/icons";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { cn } from "@/lib/ui/cn";

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
			data-card
			data-unread={n.isRead ? undefined : ""}
			className={`group transition-colors duration-150 hover:bg-[var(--surface-hover)] focus-within:ring-2 focus-within:ring-[var(--accent)]/40 ${
				n.isRead ? "" : "shadow-[inset_3px_0_0_var(--accent),var(--shadow-xs)]"
			}`}
		>
			<div className="flex items-start gap-3">
				<span className="text-lg mt-0.5 shrink-0" aria-hidden="true">{typeIcon[n.type] ?? <Bell size={18} aria-hidden="true" />}</span>
				<div className="flex-1 min-w-0">
					<div className="flex items-center gap-2 min-w-0">
						<h3 className={cn("ui-title-group truncate", n.isRead && "font-medium text-[var(--text-muted)]")} title={n.title}>{n.title}</h3>
						{!n.isRead && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />}
					</div>
					<p className="mt-1 text-xs text-[var(--text-muted)] leading-relaxed">{n.message}</p>
					<div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
						<span className="text-[var(--text-muted)]">{timeAgo(n.createdAt, nowMs, t, locale)}</span>
						{n.actionUrl && (
							<Link href={getSafeNotificationActionUrl(n.actionUrl)} className="rounded-lg px-1 py-0.5 font-medium text-[var(--accent)] transition hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
								{t("notificationsPage.action.view")}
								<ChevronRight size={12} aria-hidden className="ml-0.5 inline" />
							</Link>
						)}
						{!n.isRead && (
							<button type="button" onClick={() => onMarkRead(n.id)} className="rounded-lg px-1 py-0.5 text-[var(--text-muted)] transition hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/40">
								{t("notificationsPage.action.markOne")}
							</button>
						)}
						<ActionButton size="xs" variant="ghost" onClick={() => onDelete(n.id)} className="hover:text-[var(--danger)]">
							{t("notificationsPage.action.delete")}
						</ActionButton>
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
	// Unread-only view: with hundreds of read notifications, finding the new
	// ones meant scrolling past all history.
	const [unreadOnly, setUnreadOnly] = useState(false);

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
			await csrfFetch(`/api/notifications?id=${encodeURIComponent(id)}`, { method: "DELETE" });
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
			<div className="flex flex-wrap items-center justify-between gap-2">
				<ToggleChip active={unreadOnly} onClick={() => setUnreadOnly((v) => !v)} ariaLabel={t("notificationsPage.action.unreadOnly")}>
					{t("notificationsPage.action.unreadOnly")}{unreadCount > 0 ? ` (${unreadCount})` : ""}
				</ToggleChip>
				{unreadCount > 0 && (
					<ActionButton size="sm" variant="ghost" onClick={markAllRead}>
						{t("notificationsPage.action.markAll")}
					</ActionButton>
				)}
			</div>
			{(unreadOnly ? notifications.filter((n) => !n.isRead) : notifications).map((n) => (
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
					<ActionButton size="sm" variant="secondary"
						onClick={() => void loadMore()}
						disabled={loadingMore}>
						{loadingMore ? t("notificationsPage.loadingMore") : t("notificationsPage.loadMore")}
					</ActionButton>
				</div>
			) : null}
		</div>
	);
}
