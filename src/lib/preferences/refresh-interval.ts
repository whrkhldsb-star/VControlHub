export type RefreshIntervalOption = {
	label: string;
	value: number;
	description: string;
};

export const REFRESH_INTERVAL_OPTIONS: RefreshIntervalOption[] = [
	{ label: "关闭", value: 0, description: "仅手动刷新，流量最低" },
	{ label: "5秒", value: 5, description: "接近实时，适合临时观察" },
	{ label: "15秒", value: 15, description: "平衡实时性和开销" },
	{ label: "30秒", value: 30, description: "推荐，明显降低请求量" },
	{ label: "60秒", value: 60, description: "低流量巡检" },
	{ label: "5分钟", value: 300, description: "最低后台开销" },
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
	if (normalized === 0) return "手动刷新";
	if (normalized < 60) return `${normalized}s`;
	if (normalized % 60 === 0) return `${normalized / 60}分钟`;
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
