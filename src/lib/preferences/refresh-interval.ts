/** The intervals the preferences offer; each is named by `preferencesPage.interval.<seconds>`. */
export const REFRESH_INTERVAL_OPTIONS: ReadonlyArray<{ value: number }> = [
	{ value: 0 },
	{ value: 5 },
	{ value: 15 },
	{ value: 30 },
	{ value: 60 },
	{ value: 300 },
];

export const DEFAULT_REFRESH_INTERVAL_SECONDS = 30;
export const MIN_REFRESH_INTERVAL_SECONDS = 5;
export const MAX_REFRESH_INTERVAL_SECONDS = 300;
export const REFRESH_PREFERENCES_STORAGE_KEY = "vps-preferences";

export type RefreshPreferences = {
	autoRefreshInterval?: unknown;
};

export function normalizeRefreshIntervalSeconds(value: unknown, fallback = DEFAULT_REFRESH_INTERVAL_SECONDS): number {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	const seconds = Math.trunc(parsed);
	if (seconds <= 0) return 0;
	return Math.min(MAX_REFRESH_INTERVAL_SECONDS, Math.max(MIN_REFRESH_INTERVAL_SECONDS, seconds));
}

/**
 * An interval in the page's language, as the preferences name it ("30 秒", "5 minutes", "关闭"). It was English
 * whatever the language ("自动刷新中（5 minutes）"); an interval the preferences do not offer reads "{n} 秒".
 */
export function getRefreshIntervalLabel(seconds: number, t: (key: string, vars?: Record<string, string | number>) => string): string {
	const normalized = normalizeRefreshIntervalSeconds(seconds, seconds);
	const key = `preferencesPage.interval.${normalized}`;
	const label = t(key);
	return label === key ? t("preferencesPage.interval.seconds", { count: normalized }) : label;
}

export function getRefreshIntervalFromStorage(storage: Pick<Storage, "getItem"> | null | undefined, fallback = DEFAULT_REFRESH_INTERVAL_SECONDS): number {
	if (!storage) return fallback;
	try {
		const raw = storage.getItem(REFRESH_PREFERENCES_STORAGE_KEY);
		if (!raw) return fallback;
		const prefs = JSON.parse(raw) as RefreshPreferences;
		return normalizeRefreshIntervalSeconds(prefs.autoRefreshInterval, fallback);
	} catch {
		return fallback;
	}
}
