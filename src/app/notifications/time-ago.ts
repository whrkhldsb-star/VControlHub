import { formatDate } from "@/lib/datetime/format";
import type { Locale } from "@/lib/i18n/translations";

export function formatNotificationTimeAgo(
	dateStr: string,
	nowMs: number,
	t: (k: string, vars?: Record<string, string | number>) => string,
	locale: Locale,
): string {
	const diff = nowMs - new Date(dateStr).getTime();
	const mins = Math.floor(diff / 60_000);
	if (mins < 1) return t("notificationsPage.time.justNow");
	if (mins < 60) return t("notificationsPage.time.minutesAgo", { count: mins });
	const hours = Math.floor(mins / 60);
	if (hours < 24) return t("notificationsPage.time.hoursAgo", { count: hours });
	const days = Math.floor(hours / 24);
	if (days < 30) return t("notificationsPage.time.daysAgo", { count: days });
	return formatDate(dateStr, locale);
}
