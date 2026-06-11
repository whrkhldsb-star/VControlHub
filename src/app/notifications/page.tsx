import { requireSession } from "@/lib/auth/require-session";
import { listUserNotifications, getUnreadCount } from "@/lib/notification/service";

import { NotificationListClient } from "./notification-list-client";
import { PageShell, PageHeader } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
	const session = await requireSession();
	const [notifications, unreadCount] = await Promise.all([
		listUserNotifications(session.userId, { limit: 100 }),
		getUnreadCount(session.userId),
	]);

	const serialized = notifications.map((n) => ({
		id: n.id,
		type: n.type,
		title: n.title,
		message: n.message,
		isRead: n.isRead,
		actionUrl: n.actionUrl,
		createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
	}));

	return (
		<PageShell maxW="max-w-7xl">
				<PageHeader
					eyebrow="Notifications"
					title="通知中心"
					description={unreadCount > 0 ? `${unreadCount} 条未读通知` : "所有通知已读"}
				/>
				<NotificationListClient initialNotifications={serialized} initialUnreadCount={unreadCount} />
		</PageShell>
	);
}
