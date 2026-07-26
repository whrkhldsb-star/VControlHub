import { prisma } from "@/lib/db";
import { pushNotification, pushUnreadCount } from "@/lib/ws/notification-ws";
import { createLogger } from "@/lib/logging";
import { NotFoundError } from "@/lib/errors";
import { timeDelivery } from "@/lib/monitoring/runtime-metrics";
import { t } from "@/lib/i18n/translations";

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

export type CreateNotificationInput = {
	userId: string;
	type: NotificationType;
	title: string;
	message: string;
	actionUrl?: string;
	/** Optional multi-tenant stamp (null = shared/legacy). */
	teamId?: string | null;
};

/* ── CRUD ─────────────────────────────────────────────────── */

export async function createNotification(input: CreateNotificationInput) {
	const record = await prisma.notification.create({
		data: {
			userId: input.userId,
			type: input.type,
			title: input.title,
			message: input.message,
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
				actionUrl: record.actionUrl,
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
	// Notify approvers. Prefer same-team members when teamId is set so other
	// tenants' admins are not spammed with foreign command requests.
	const admins = await prisma.user.findMany({
		where: {
			roles: { some: { role: { permissions: { some: { permission: { key: "command:approve" } } } } } },
			...(teamId
				? {
						OR: [
							{ teamMemberships: { some: { teamId } } },
							// Global team managers may lack membership rows but still approve.
							{ roles: { some: { role: { permissions: { some: { permission: { key: "team:manage" } } } } } } },
						],
					}
				: {}),
		},
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
					title: t("backend.notification.commandPendingTitle"),
					message: t("backend.notification.commandPendingMessage", { title: commandTitle }),
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
		// Reuse failed channel type for storage compatibility; title/message convey cancel.
		cancelled: "command_failed" as NotificationType,
	};
	const titleMap = {
		approved: "Command approved",
		rejected: "Command rejected",
		completed: "Command execution completed",
		failed: "Command execution failed",
		cancelled: "Command cancelled",
	};
	const msgMap = {
		approved: `Command "${commandTitle}" has been approved and will execute shortly.`,
		rejected: `Command "${commandTitle}" has been rejected.`,
		completed: `Command "${commandTitle}" executed successfully.`,
		failed: `Command "${commandTitle}" execution failed.`,
		cancelled: `Command "${commandTitle}" was cancelled by an operator.`,
	};
	return createNotification({
		userId: requesterId,
		type: typeMap[status],
		title: titleMap[status],
		message: msgMap[status],
		actionUrl: "/requests",
		teamId: teamId ?? null,
	});
}

export async function notifyDownloadResult(
	userId: string,
	url: string,
	status: "completed" | "failed",
	errorMsg?: string,
	teamId?: string | null,
) {
	const truncatedUrl = url.length > 50 ? url.slice(0, 47) + "..." : url;
	return createNotification({
		userId,
		type: status === "completed" ? "download_completed" : "download_failed",
		title: status === "completed" ? "Download completed" : "Download failed",
		message: status === "completed" ? `Download completed: ${truncatedUrl}` : `Download failed: ${truncatedUrl}${errorMsg ? ` — ${errorMsg}` : ""}`,
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
		title: `Task consecutive failures: ${taskName}`,
		message: `Task "${taskName}" has failed ${failCount} consecutive times. Last error: ${lastError}.`,
		actionUrl: "/scheduled-tasks",
		teamId: teamId ?? null,
	});
}
