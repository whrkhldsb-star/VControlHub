/**
 * VPS 自动探测间隔 (per-user preference)
 *
 * 与 `refresh-interval.ts` 同源: 提供下拉选项 + normalize 工具,
 * 共享给 /preferences 页面渲染控件和 /servers 页面消费设置。
 *
 * 历史背景: 这个设置以前在 `src/app/servers/auto-probe-context.tsx` 用
 * localStorage 持久化 (每浏览器独立)。集中到 UserPreferences 后,
 * 跨浏览器同步且 /preferences 页面统一管理。
 */

/** The intervals the preferences offer; each is named by `preferencesPage.interval.<seconds>`. */
export const AUTO_PROBE_INTERVAL_OPTIONS: ReadonlyArray<{ value: number }> = [
	{ value: 10 },
	{ value: 30 },
	{ value: 60 },
	{ value: 120 },
	{ value: 300 },
];

export const DEFAULT_AUTO_PROBE_INTERVAL_SEC = 60;
export const MIN_AUTO_PROBE_INTERVAL_SEC = 10;
export const MAX_AUTO_PROBE_INTERVAL_SEC = 300;

export const AUTO_PROBE_ALLOWED_INTERVALS = AUTO_PROBE_INTERVAL_OPTIONS.map((opt) => opt.value);

export function normalizeAutoProbeIntervalSec(value: unknown, fallback = DEFAULT_AUTO_PROBE_INTERVAL_SEC): number {
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isFinite(parsed)) return fallback;
	const seconds = Math.trunc(parsed);
	if (seconds <= 0) return fallback;
	const allowed = AUTO_PROBE_ALLOWED_INTERVALS as readonly number[];
	return allowed.includes(seconds) ? seconds : fallback;
}
