import { isGlobalTeamManager, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { pushNotification, pushUnreadCount } from "@/lib/ws/notification-ws";
import { createLogger } from "@/lib/logging";
import { NotFoundError } from "@/lib/errors";
import { timeDelivery } from "@/lib/monitoring/runtime-metrics";
import { backgroundCopyLocale } from "@/lib/i18n/api-copy";
import { t } from "@/lib/i18n/service-translations";
import { renderNotificationFallback, type NotificationMessage } from "./message";
import { permissionHoldersWhere } from "@/lib/auth/permission-holders";

import { currentRecipient, inboxWhere, PLATFORM_ANNOUNCEMENT, pushPayload, readUnreadCount, type StoredNotification } from "./inbox";
export { getUnreadCount, listUserNotifications, readUnreadCount, STORED_NOTIFICATION_SELECT, type StoredNotification } from "./inbox";

const logger = createLogger("notification:service");

/* ── Types ────────────────────────────────────────────────── */

export type NotificationType =
	| typeof PLATFORM_ANNOUNCEMENT
	| "command_pending"
	| "command_approved"
	| "command_rejected"
	| "command_completed"
	| "command_failed"
	| "download_completed"
	| "download_failed"
	| "server_alert"
	| "alert_resolved"
	| "task_consecutive_failed"
	| "system"
	| "backup_completed"
	| "backup_failed"
	| "login_alert"
	| "cron_failed"
	| "playbook_failed"
	/** Free text sent by a playbook's "send notification" step. */
	| "playbook"
	/** A ticket past its SLA was raised one priority (written by the SLA sweep). */
	| "ticket_escalation";

/**
 * Either an event `notice` (rendered per viewer locale; explicit title/message
 * override the stored fallback) or plain title/message text.
 */
type NotificationContent =
	| { notice: NotificationMessage; title?: string; message?: string }
	| { notice?: undefined; title: string; message: string };

export type CreateNotificationInput = NotificationContent & {
	userId: string;
	type: NotificationType;
	actionUrl?: string;
	/** A null stamp is private to administrators except for explicit platform announcements. */
	teamId?: string | null;
};

/**
 * Columns for a notification row: fallback text plus the optional event code.
 * The fallback is what a reader gets who cannot render the code (an API
 * client, an older page): in the process's language where it has one (the
 * worker: the platform default), never in the language of whoever happened to
 * trigger the notice.
 */
export function notificationContentData(content: NotificationContent) {
	const fallback = content.notice ? renderNotificationFallback(content.notice, backgroundCopyLocale() ?? "zh") : null;
	return {
		title: content.title ?? fallback?.title ?? "",
		message: content.message ?? fallback?.message ?? "",
		messageCode: content.notice?.code ?? null,
		messageParams: content.notice?.params ?? undefined,
	};
}

export async function createNotification(input: CreateNotificationInput, deliveryId?: string) {
	const data = {
		userId: input.userId,
		type: input.type,
		...notificationContentData(input),
		actionUrl: input.actionUrl ?? null,
		teamId: input.teamId ?? null,
	};
	// A lost commit acknowledgement can be retried with the same run/step
	// key. Only the transaction that inserted the inbox row announces it.
	const record = deliveryId
		? (await prisma.notification.createManyAndReturn({ data: { ...data, id: deliveryId }, skipDuplicates: true }))[0]
		: await prisma.notification.create({ data });
	if (!record) return prisma.notification.findUniqueOrThrow({ where: { id: deliveryId } });
	await announceStoredNotifications([record]);
	return record;
}

/**
 * Tell the recipients' open pages about rows that are already stored: each
 * row, then the recipient's unread count. While its socket is connected the
 * bell takes both the toast and the badge from these pushes, so a row written
 * without them stays invisible until the page is reloaded. Rows written
 * several at once or inside a transaction are announced here, after the
 * transaction has committed.
 *
 * Best effort and never throws: the rows are stored, and a recipient who
 * cannot be reached sees them on the next load.
 */
export async function announceStoredNotifications(records: readonly StoredNotification[]): Promise<void> {
	const byRecipient = new Map<string, StoredNotification[]>();
	for (const record of records) {
		const rows = byRecipient.get(record.userId);
		if (rows) rows.push(record);
		else byRecipient.set(record.userId, [record]);
	}
	for (const [userId, rows] of byRecipient) {
		try {
			await timeDelivery("in_app_ws", async () => {
				const recipient = await currentRecipient(userId);
				if (!recipient) return;
				for (const row of rows) {
					const visible = row.teamId === null
						? row.type === PLATFORM_ANNOUNCEMENT
						: row.teamId === recipient.currentTeamId;
					if (!visible && !isGlobalTeamManager(recipient)) continue;
					pushNotification(userId, pushPayload(row));
				}
				await pushCurrentUnreadCount(userId);
			});
		} catch (err) {
			logger.warn("WS push failed (user may be offline)", err);
		}
	}
}

async function pushCurrentUnreadCount(userId: string) {
	const { count, asOfUs } = await readUnreadCount(userId);
	pushUnreadCount(userId, count, asOfUs);
}

export async function markAsRead(notificationId: string, session: TeamSession) {
	const result = await prisma.notification.updateMany({
		where: { ...inboxWhere(session), id: notificationId },
		data: { isRead: true },
	});
	if (result.count === 0) {
		throw new NotFoundError(t("backend.notification.notificationNotFoundOrForbidden"));
	}
	// Push updated unread count after marking as read (best-effort; DB already committed)
	try {
		await pushCurrentUnreadCount(session.userId);
	} catch (err) {
		logger.warn("WS unread push failed after markAsRead", err);
	}
	return result;
}

export async function markAllAsRead(session: TeamSession) {
	const result = await prisma.notification.updateMany({
		where: { ...inboxWhere(session), isRead: false },
		data: { isRead: true },
	});
	// The count as it is now, not 0: a notification created while the update
	// ran is still unread, and a late "0" overwrote its badge.
	try {
		await pushCurrentUnreadCount(session.userId);
	} catch (err) {
		logger.warn("WS unread push failed after markAllAsRead", err);
	}
	return result;
}

export async function deleteNotification(notificationId: string, session: TeamSession) {
	const result = await prisma.notification.deleteMany({
		where: { ...inboxWhere(session), id: notificationId },
	});
	if (result.count === 0) {
		throw new NotFoundError(t("backend.notification.notificationNotFoundOrForbidden"));
	}
	// Push updated unread count after deletion (best-effort; DB already committed)
	try {
		await pushCurrentUnreadCount(session.userId);
	} catch (err) {
		logger.warn("WS unread push failed after deleteNotification", err);
	}
	return result;
}

/* ── Helpers: create notifications for specific events ────── */

export async function notifyCommandPending(
	requesterId: string,
	commandTitle: string,
	teamId?: string | null,
) {
	// Approvers: platform administrators plus this customer's accounts allowed
	// to approve. A null-team (legacy) request only reaches administrators.
	const admins = await prisma.user.findMany({
		where: { status: { not: "DISABLED" }, ...permissionHoldersWhere("command:approve", teamId) },
		select: { id: true },
		take: 1000,
	});
	await Promise.all(
		admins
			.filter((a) => a.id !== requesterId)
			.map((admin) =>
				createNotification({
					userId: admin.id,
					type: "command_pending",
					notice: { code: "commandPending", params: { title: commandTitle } },
					actionUrl: `/requests`,
					teamId: teamId ?? null,
				}),
			),
	);
}

export async function notifyCommandResult(
	requesterId: string,
	commandTitle: string,
	status: "approved" | "rejected" | "completed" | "failed" | "cancelled",
	teamId?: string | null,
) {
	const typeMap = {
		approved: "command_approved" as NotificationType,
		rejected: "command_rejected" as NotificationType,
		completed: "command_completed" as NotificationType,
		failed: "command_failed" as NotificationType,
		// Reuse failed channel type for storage compatibility; the message code conveys cancel.
		cancelled: "command_failed" as NotificationType,
	};
	const codeMap = {
		approved: "commandApproved",
		rejected: "commandRejected",
		completed: "commandCompleted",
		failed: "commandFailed",
		cancelled: "commandCancelled",
	} as const;
	return createNotification({
		userId: requesterId,
		type: typeMap[status],
		notice: { code: codeMap[status], params: { title: commandTitle } },
		actionUrl: "/requests",
		teamId: teamId ?? null,
	});
}

export async function notifyDownloadResult(
	userId: string,
	url: string,
	status: "completed" | "failed",
	/** Free text, or a notification-messages key shown in the viewer's language. */
	error?: string | { key: string },
	teamId?: string | null,
) {
	// Use only the hostname. Transfer URLs and errors quoting even a relative
	// request target can carry credentials into the stored and pushed copy.
	let source = "—";
	try {
		const parsed = new URL(url);
		if (["http:", "https:"].includes(parsed.protocol)) source = parsed.hostname;
	} catch { /* Malformed and legacy sources use the neutral label. */ }
	const reason = typeof error === "string" && /[/\\?#=]/.test(error) ? undefined : error;
	let notice: NotificationMessage = { code: "downloadCompleted", params: { url: source } };
	if (status === "failed") {
		notice = reason
			? { code: "downloadFailedWithReason", params: { url: source, ...(typeof reason === "string" ? { error: reason } : { errorKey: reason.key }) } }
			: { code: "downloadFailed", params: { url: source } };
	}
	return createNotification({
		userId,
		type: status === "completed" ? "download_completed" : "download_failed",
		notice,
		actionUrl: "/downloads",
		teamId: teamId ?? null,
	});
}

export async function notifyTaskConsecutiveFailed(
	userId: string,
	taskName: string,
	failCount: number,
	lastError: string,
	teamId?: string | null,
) {
	return createNotification({
		userId,
		type: "task_consecutive_failed",
		notice: { code: "taskConsecutiveFailed", params: { task: taskName, count: failCount, error: lastError } },
		actionUrl: "/scheduled-tasks",
		teamId: teamId ?? null,
	});
}
