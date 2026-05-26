const NOTIFICATIONS_FALLBACK_PATH = "/notifications";

export function getSafeNotificationActionUrl(actionUrl: string | null | undefined) {
	if (!actionUrl) return NOTIFICATIONS_FALLBACK_PATH;

	const trimmed = actionUrl.trim();
	if (!trimmed || !trimmed.startsWith("/") || trimmed.startsWith("//")) {
		return NOTIFICATIONS_FALLBACK_PATH;
	}

	return trimmed;
}
