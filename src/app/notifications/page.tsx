import { requireSession } from "@/lib/auth/require-session";
import { listUserNotifications, getUnreadCount } from "@/lib/notification/service";

import { NotificationListClient } from "./notification-list-client";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
	const session = await requireSession();
	const locale = await getServerLocale();
	const [notifications, unreadCount] = await Promise.all([
		listUserNotifications(session.userId, { limit: 50 }),
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
		<PageShell maxW="max-w-3xl">
			<PageHeader
				eyebrow={t("notificationsPage.eyebrow", locale)}
				title={t("notificationsPage.title", locale)}
				description={
					unreadCount > 0
						? t("notificationsPage.unread", locale).replace("{count}", String(unreadCount))
						: t("notificationsPage.allRead", locale)
				}
			/>
			<NotificationListClient
				initialNotifications={serialized}
				initialUnreadCount={unreadCount}
				locale={locale}
			/>
		</PageShell>
	);
}
