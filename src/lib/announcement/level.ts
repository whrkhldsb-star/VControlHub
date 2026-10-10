/**
 * Announcement levels and how the interface shows them. Client-safe.
 */
import type { StatusTone } from "@/components/status-badge";

export const ANNOUNCEMENT_LEVEL_TONES: Record<string, StatusTone> = {
	info: "info",
	warning: "warning",
	urgent: "danger",
};

export function announcementLevelTone(level: string): StatusTone {
	return ANNOUNCEMENT_LEVEL_TONES[level] ?? "info";
}

/** Built-in levels are translated; an unknown level shows as stored. */
export function announcementLevelLabel(t: (key: string) => string, level: string): string {
	const key = `announcementsPage.level.${level}`;
	const translated = t(key);
	return translated === key ? level : translated;
}
