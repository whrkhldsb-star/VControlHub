export type RefreshIntervalOption = {
	label: string;
	value: number;
	description: string;
};

export const REFRESH_INTERVAL_OPTIONS: RefreshIntervalOption[] = [
	{ label: "Off", value: 0, description: "Manual refresh only; lowest traffic" },
	{ label: "5s", value: 5, description: "Near real-time; suitable for temporary observation" },
	{ label: "15s", value: 15, description: "Balances real-time and overhead" },
	{ label: "30s", value: 30, description: "Recommended; significantly reduces request volume" },
	{ label: "60s", value: 60, description: "Low-traffic inspection" },
	{ label: "5 minutes", value: 300, description: "Lowest background overhead" },
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

export function getRefreshIntervalLabel(seconds: number): string {
	const normalized = normalizeRefreshIntervalSeconds(seconds, seconds);
	if (normalized === 0) return "Manual refresh";
	if (normalized < 60) return `${normalized}s`;
	if (normalized % 60 === 0) return `${normalized / 60} minutes`;
	return `${normalized}s`;
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
