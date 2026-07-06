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
		logger.warn("WS推送失败（用户可能不在线）", err);
	}

	return record;
}

export async function listUserNotifications(userId: string, opts?: { unreadOnly?: boolean; limit?: number }) {
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
		throw new NotFoundError("通知不存在或无权操作");
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
		throw new NotFoundError("通知不存在或无权操作");
	}
	// Push updated unread count after deletion
	const unreadCount = await getUnreadCount(userId);
	pushUnreadCount(userId, unreadCount);
	return result;
}

/* ── Helpers: create notifications for specific events ────── */

export async function notifyCommandPending(requesterId: string, commandTitle: string) {
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
					title: "新命令待审批",
					message: `命令「${commandTitle}」需要你的审批。`,
					actionUrl: `/requests`,
				}),
			),
	);
}

export async function notifyCommandResult(requesterId: string, commandTitle: string, status: "approved" | "rejected" | "completed" | "failed") {
	const typeMap = {
		approved: "command_approved" as NotificationType,
		rejected: "command_rejected" as NotificationType,
		completed: "command_completed" as NotificationType,
		failed: "command_failed" as NotificationType,
	};
	const titleMap = {
		approved: "命令已批准",
		rejected: "命令已拒绝",
		completed: "命令执行完成",
		failed: "命令执行失败",
	};
	const msgMap = {
		approved: `命令「${commandTitle}」已被批准，即将执行。`,
		rejected: `命令「${commandTitle}」已被拒绝。`,
		completed: `命令「${commandTitle}」已成功执行。`,
		failed: `命令「${commandTitle}」执行失败。`,
	};
	return createNotification({
		userId: requesterId,
		type: typeMap[status],
		title: titleMap[status],
		message: msgMap[status],
		actionUrl: "/requests",
	});
}

export async function notifyDownloadResult(userId: string, url: string, status: "completed" | "failed", errorMsg?: string) {
	const truncatedUrl = url.length > 50 ? url.slice(0, 47) + "..." : url;
	return createNotification({
		userId,
		type: status === "completed" ? "download_completed" : "download_failed",
		title: status === "completed" ? "下载完成" : "下载失败",
		message: status === "completed" ? `下载已完成：${truncatedUrl}` : `下载失败：${truncatedUrl}${errorMsg ? ` — ${errorMsg}` : ""}`,
		actionUrl: "/downloads",
	});
}

export async function notifyServerAlert(userId: string, serverName: string, alertMessage: string) {
	return createNotification({
		userId,
		type: "server_alert",
		title: `服务器告警：${serverName}`,
		message: alertMessage,
		actionUrl: "/servers",
	});
}

export async function notifyBackupCompleted(userId: string, backupType: string, size: string) {
	return createNotification({
		userId,
		type: "backup_completed",
		title: "备份完成",
		message: `类型 ${backupType} 备份已完成，大小：${size}。`,
		actionUrl: "/backups",
	});
}

export async function notifyBackupFailed(userId: string, backupType: string, error: string) {
	return createNotification({
		userId,
		type: "backup_failed",
		title: "备份失败",
		message: `类型 ${backupType} 备份失败：${error}。`,
		actionUrl: "/backups",
	});
}

export async function notifyLoginAlert(userId: string, ip: string, userAgent?: string) {
	return createNotification({
		userId,
		type: "login_alert",
		title: "异常登录提醒",
		message: `检测到来自 ${ip} 的新登录${userAgent ? ` (${userAgent})` : ""}，如非本人操作请立即修改密码。`,
		actionUrl: "/settings#security",
	});
}

export async function notifyCronFailed(userId: string, taskName: string, error: string) {
	return createNotification({
		userId,
		type: "cron_failed",
		title: "定时任务失败",
		message: `定时任务「${taskName}」执行失败：${error}。`,
		actionUrl: "/scheduled-tasks",
	});
}

export async function notifyPlaybookFailed(userId: string, playbookName: string, stepName: string, error: string) {
	return createNotification({
		userId,
		type: "playbook_failed",
		title: "Playbook 执行失败",
		message: `Playbook「${playbookName}」在步骤「${stepName}」失败：${error}。`,
		actionUrl: `/playbooks/${playbookName}`,
	});
}

export async function notifyAlertResolved(userId: string, serverName: string, metric: string, previousThreshold: number) {
	return createNotification({
		userId,
		type: "alert_resolved",
		title: `告警恢复：${serverName}`,
		message: `${serverName} 的 ${metric} 指标已恢复正常（此前阈值 ${previousThreshold}）。`,
		actionUrl: "/health",
	});
}

export async function notifyTaskConsecutiveFailed(userId: string, taskName: string, failCount: number, lastError: string) {
	return createNotification({
		userId,
		type: "task_consecutive_failed",
		title: `任务连续失败：${taskName}`,
		message: `任务「${taskName}」已连续失败 ${failCount} 次，最近错误：${lastError}。`,
		actionUrl: "/scheduled-tasks",
	});
}
