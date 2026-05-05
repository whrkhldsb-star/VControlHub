import { requireSession } from "@/lib/auth/require-session";
import { listUserNotifications, getUnreadCount } from "@/lib/notification/service";

import { NotificationListClient } from "./notification-list-client";

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
		<main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100">
			<div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
				<header className="mb-8">
					<h1 className="text-3xl font-semibold tracking-tight text-white">通知中心</h1>
					<p className="mt-1.5 text-sm text-slate-500">
						{unreadCount > 0 ? `${unreadCount} 条未读通知` : "所有通知已读"}
					</p>
				</header>
				<NotificationListClient initialNotifications={serialized} initialUnreadCount={unreadCount} />
			</div>
		</main>
	);
}
