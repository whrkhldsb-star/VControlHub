import { prisma } from "@/lib/db";
import { pushNotification, pushUnreadCount } from "@/lib/ws/notification-ws";
import { createLogger } from "@/lib/logging";
import { NotFoundError } from "@/lib/errors";

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
	} catch (err) {
		logger.warn("WS push failed (user may be offline)", err);
	}

	return record;
}

export async function listUserNotifications(userId: string, opts?: { unreadOnly?: boolean; limit?: number; session?: { userId: string; roles: import("@/lib/auth/rbac").RoleKey[]; currentTeamId: string | null } }) {
	return prisma.notification.findMany({
		where: {
			userId,
			...(opts?.unreadOnly ? { isRead: false } : {}),
		},
		orderBy: { createdAt: "desc" },
		take: opts?.limit ?? 50,
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
		throw new NotFoundError("Notification not found or forbidden");
	}
	// Push updated unread count after marking as read
	const unreadCount = await getUnreadCount(userId);
	pushUnreadCount(userId, unreadCount);
	return result;
}

export async function markAllAsRead(userId: string) {
	const result = await prisma.notification.updateMany({
		where: { userId, isRead: false },
		data: { isRead: true },
	});
	pushUnreadCount(userId, 0);
	return result;
}

export async function deleteNotification(notificationId: string, userId: string) {
	const result = await prisma.notification.deleteMany({
		where: { id: notificationId, userId },
	});
	if (result.count === 0) {
		throw new NotFoundError("Notification not found or forbidden");
	}
	// Push updated unread count after deletion
	const unreadCount = await getUnreadCount(userId);
	pushUnreadCount(userId, unreadCount);
	return result;
}

/* ── Helpers: create notifications for specific events ────── */

export async function notifyCommandPending(
	requesterId: string,
	commandTitle: string,
	teamId?: string | null,
) {
	// Notify all admins about pending command
	const admins = await prisma.user.findMany({
		where: { roles: { some: { role: { permissions: { some: { permission: { key: "command:approve" } } } } } } },
		select: { id: true },
		take: 1000, // P2: approve 权限的 admin 数有限
	});
	await Promise.all(
		admins
			.filter((a) => a.id !== requesterId)
			.map((admin) =>
				createNotification({
					userId: admin.id,
					type: "command_pending",
					title: "New command pending approval",
					message: `Command "${commandTitle}" requires your approval.`,
					actionUrl: `/requests`,
					teamId: teamId ?? null,
				}),
			),
	);
}

export async function notifyCommandResult(
	requesterId: string,
	commandTitle: string,
	status: "approved" | "rejected" | "completed" | "failed",
	teamId?: string | null,
) {
	const typeMap = {
		approved: "command_approved" as NotificationType,
		rejected: "command_rejected" as NotificationType,
		completed: "command_completed" as NotificationType,
		failed: "command_failed" as NotificationType,
	};
	const titleMap = {
		approved: "Command approved",
		rejected: "Command rejected",
		completed: "Command execution completed",
		failed: "Command execution failed",
	};
	const msgMap = {
		approved: `Command "${commandTitle}" has been approved and will execute shortly.`,
		rejected: `Command "${commandTitle}" has been rejected.`,
		completed: `Command "${commandTitle}" executed successfully.`,
		failed: `Command "${commandTitle}" execution failed.`,
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

export async function notifyServerAlert(
	userId: string,
	serverName: string,
	alertMessage: string,
	teamId?: string | null,
) {
	return createNotification({
		userId,
		type: "server_alert",
		title: `Server alert: ${serverName}`,
		message: alertMessage,
		actionUrl: "/servers",
		teamId: teamId ?? null,
	});
}

export async function notifyBackupCompleted(
	userId: string,
	backupType: string,
	size: string,
	teamId?: string | null,
) {
	return createNotification({
		userId,
		type: "backup_completed",
		title: "Backup completed",
		message: `${backupType} backup completed, size: ${size}.`,
		actionUrl: "/backups",
		teamId: teamId ?? null,
	});
}

export async function notifyBackupFailed(
	userId: string,
	backupType: string,
	error: string,
	teamId?: string | null,
) {
	return createNotification({
		userId,
		type: "backup_failed",
		title: "Backup failed",
		message: `${backupType} backup failed: ${error}.`,
		actionUrl: "/backups",
		teamId: teamId ?? null,
	});
}

export async function notifyLoginAlert(userId: string, ip: string, userAgent?: string) {
	return createNotification({
		userId,
		type: "login_alert",
		title: "Abnormal login alert",
		message: `A new login from ${ip} was detected${userAgent ? ` (${userAgent})` : ""}. If this was not you, please change your password immediately.`,
		actionUrl: "/settings#security",
	});
}

export async function notifyCronFailed(
	userId: string,
	taskName: string,
	error: string,
	teamId?: string | null,
) {
	return createNotification({
		userId,
		type: "cron_failed",
		title: "Scheduled task failed",
		message: `Scheduled task "${taskName}" execution failed: ${error}.`,
		actionUrl: "/scheduled-tasks",
		teamId: teamId ?? null,
	});
}

export async function notifyPlaybookFailed(
	userId: string,
	playbookName: string,
	stepName: string,
	error: string,
	teamId?: string | null,
) {
	return createNotification({
		userId,
		type: "playbook_failed",
		title: "Playbook execution failed",
		message: `Playbook "${playbookName}" failed at step "${stepName}": ${error}.`,
		actionUrl: `/playbooks/${playbookName}`,
		teamId: teamId ?? null,
	});
}

export async function notifyAlertResolved(
	userId: string,
	serverName: string,
	metric: string,
	previousThreshold: number,
	teamId?: string | null,
) {
	return createNotification({
		userId,
		type: "alert_resolved",
		title: `Alert resolved: ${serverName}`,
		message: `${serverName}'s ${metric} metric has returned to normal (previous threshold: ${previousThreshold}).`,
		actionUrl: "/health",
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
