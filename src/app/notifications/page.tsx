import { requireSession } from "@/lib/auth/require-session";
import { listUserNotifications, getUnreadCount } from "@/lib/notification/service";

import { NotificationListClient } from "./notification-list-client";
import { PageShell } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
	const session = await requireSession("/notifications");
	const [notifications, unreadCount] = await Promise.all([
		listUserNotifications(session.userId, { limit: 50 }),
		getUnreadCount(session.userId),
	]);

	const serialized = notifications.map((n) => ({
		id: n.id,
		type: n.type,
		title: n.title,
		message: n.message,
		messageCode: n.messageCode,
		messageParams: n.messageParams,
		isRead: n.isRead,
		actionUrl: n.actionUrl,
		teamId: n.teamId,
		teamName: n.team?.name ?? null,
		createdAt: n.createdAt instanceof Date ? n.createdAt.toISOString() : String(n.createdAt),
	}));

	return (
		<PageShell>
			<NotificationListClient
				initialNotifications={serialized}
				initialUnreadCount={unreadCount}
				initialNow={new Date().toISOString()}
			/>
		</PageShell>
	);
}
