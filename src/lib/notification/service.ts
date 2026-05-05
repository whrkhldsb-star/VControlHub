import { prisma } from "@/lib/db";

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
	| "system";

export type CreateNotificationInput = {
	userId: string;
	type: NotificationType;
	title: string;
	message: string;
	actionUrl?: string;
};

/* ── CRUD ─────────────────────────────────────────────────── */

export async function createNotification(input: CreateNotificationInput) {
	return prisma.notification.create({
		data: {
			userId: input.userId,
			type: input.type,
			title: input.title,
			message: input.message,
			actionUrl: input.actionUrl ?? null,
		},
	});
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
	return prisma.notification.updateMany({
		where: { id: notificationId, userId },
		data: { isRead: true },
	});
}

export async function markAllAsRead(userId: string) {
	return prisma.notification.updateMany({
		where: { userId, isRead: false },
		data: { isRead: true },
	});
}

export async function deleteNotification(notificationId: string, userId: string) {
	return prisma.notification.deleteMany({
		where: { id: notificationId, userId },
	});
}

/* ── Helpers: create notifications for specific events ────── */

export async function notifyCommandPending(requesterId: string, commandTitle: string) {
	// Notify all admins about pending command
	const admins = await prisma.user.findMany({
		where: { roles: { some: { role: { permissions: { some: { permission: { key: "command:approve" } } } } } } },
		select: { id: true },
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
