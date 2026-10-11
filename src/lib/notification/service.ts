import { prisma } from "@/lib/db";
import { pushNotification, pushUnreadCount } from "@/lib/ws/notification-ws";
import { createLogger } from "@/lib/logging";
import { NotFoundError } from "@/lib/errors";
import { timeDelivery } from "@/lib/monitoring/runtime-metrics";
import { t } from "@/lib/i18n/service-translations";
import { renderNotificationFallback, type NotificationMessage } from "./message";
import { permissionHoldersWhere } from "@/lib/auth/permission-holders";

const logger = createLogger("notification:service");

/* ── Types ────────────────────────────────────────────────── */

export type NotificationType =
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
	| "playbook_failed";

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
	/** Optional multi-tenant stamp (null = shared/legacy). */
	teamId?: string | null;
};

/** Columns for a notification row: fallback text plus the optional event code. */
export function notificationContentData(content: NotificationContent) {
	const fallback = content.notice ? renderNotificationFallback(content.notice) : null;
	return {
		title: content.title ?? fallback?.title ?? "",
		message: content.message ?? fallback?.message ?? "",
		messageCode: content.notice?.code ?? null,
		messageParams: content.notice?.params ?? undefined,
	};
}

/* ── CRUD ─────────────────────────────────────────────────── */

export async function createNotification(input: CreateNotificationInput) {
	const record = await prisma.notification.create({
		data: {
			userId: input.userId,
			type: input.type,
			...notificationContentData(input),
			actionUrl: input.actionUrl ?? null,
			teamId: input.teamId ?? null,
		},
	});

	// Push real-time WebSocket notification to the user
	try {
		await timeDelivery("in_app_ws", async () => {
			pushNotification(input.userId, {
				id: record.id,
				title: record.title,
				message: record.message,
				messageCode: record.messageCode,
				messageParams: record.messageParams,
				actionUrl: record.actionUrl,
				teamId: record.teamId,
				createdAt: record.createdAt.toISOString(),
			});

			// Also push updated unread count
			const unreadCount = await getUnreadCount(input.userId);
			pushUnreadCount(input.userId, unreadCount);
		});
	} catch (err) {
		logger.warn("WS push failed (user may be offline)", err);
	}

	return record;
}

export async function listUserNotifications(userId: string, opts?: { unreadOnly?: boolean; limit?: number; skip?: number }) {
	return prisma.notification.findMany({
		where: {
			userId,
			...(opts?.unreadOnly ? { isRead: false } : {}),
		},
		orderBy: { createdAt: "desc" },
		take: opts?.limit ?? 50,
		...(opts?.skip && opts.skip > 0 ? { skip: opts.skip } : {}),
		// Administrators receive notifications from every customer; name the source.
		include: { team: { select: { name: true } } },
	});
}

export async function getUnreadCount(userId: string): Promise<number> {
	return prisma.notification.count({
		where: { userId, isRead: false },
	});
}

export async function markAsRead(notificationId: string, userId: string) {
	const result = await prisma.notification.updateMany({
		where: { id: notificationId, userId },
		data: { isRead: true },
	});
	if (result.count === 0) {
		throw new NotFoundError(t("backend.notification.notificationNotFoundOrForbidden"));
	}
	// Push updated unread count after marking as read (best-effort; DB already committed)
	try {
		const unreadCount = await getUnreadCount(userId);
		pushUnreadCount(userId, unreadCount);
	} catch (err) {
		logger.warn("WS unread push failed after markAsRead", err);
	}
	return result;
}

export async function markAllAsRead(userId: string) {
	const result = await prisma.notification.updateMany({
		where: { userId, isRead: false },
		data: { isRead: true },
	});
	try {
		pushUnreadCount(userId, 0);
	} catch (err) {
		logger.warn("WS unread push failed after markAllAsRead", err);
	}
	return result;
}

export async function deleteNotification(notificationId: string, userId: string) {
	const result = await prisma.notification.deleteMany({
		where: { id: notificationId, userId },
	});
	if (result.count === 0) {
		throw new NotFoundError(t("backend.notification.notificationNotFoundOrForbidden"));
	}
	// Push updated unread count after deletion (best-effort; DB already committed)
	try {
		const unreadCount = await getUnreadCount(userId);
		pushUnreadCount(userId, unreadCount);
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
	const truncatedUrl = url.length > 50 ? url.slice(0, 47) + "..." : url;
	return createNotification({
		userId,
		type: status === "completed" ? "download_completed" : "download_failed",
		notice: status === "completed"
			? { code: "downloadCompleted", params: { url: truncatedUrl } }
			: error
				? { code: "downloadFailedWithReason", params: { url: truncatedUrl, ...(typeof error === "string" ? { error } : { errorKey: error.key }) } }
				: { code: "downloadFailed", params: { url: truncatedUrl } },
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
