/**
 * Formatting for the status board. Binary (IEC) units throughout, labelled as
 * such: 1 KiB = 1024 B. Rates are bytes per second. A missing value renders
 * as the fallback, never as zero.
 */

const BYTE_UNITS = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];

export function formatIecBytes(bytes: number | null | undefined, fallback = "—"): string {
	if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return fallback;
	let value = bytes;
	let unit = 0;
	while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
		value /= 1024;
		unit += 1;
	}
	const digits = unit === 0 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
	return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`;
}

export function formatIecRate(bytesPerSecond: number | null | undefined, fallback = "—"): string {
	const formatted = formatIecBytes(bytesPerSecond, "");
	return formatted ? `${formatted}/s` : fallback;
}

export function formatPercent(value: number | null | undefined, fallback = "—"): string {
	if (value === null || value === undefined || !Number.isFinite(value)) return fallback;
	return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)}%`;
}

export function formatLatency(ms: number | null | undefined, fallback = "—"): string {
	if (ms === null || ms === undefined || !Number.isFinite(ms)) return fallback;
	return ms >= 100 ? `${Math.round(ms)} ms` : `${ms.toFixed(1)} ms`;
}

export function formatDuration(seconds: number | null | undefined, locale: "zh" | "en", fallback = "—"): string {
	if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return fallback;
	const days = Math.floor(seconds / 86_400);
	const hours = Math.floor((seconds % 86_400) / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	if (locale === "zh") {
		if (days > 0) return `${days} 天 ${hours} 小时`;
		if (hours > 0) return `${hours} 小时 ${minutes} 分`;
		return `${minutes} 分钟`;
	}
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}

/** "12 s ago" style age of an ISO timestamp relative to `nowMs`. */
export function formatAge(iso: string | null | undefined, nowMs: number, locale: "zh" | "en", fallback = "—"): string {
	if (!iso) return fallback;
	const at = Date.parse(iso);
	if (!Number.isFinite(at)) return fallback;
	const seconds = Math.max(0, Math.round((nowMs - at) / 1000));
	if (seconds < 60) return locale === "zh" ? `${seconds} 秒前` : `${seconds}s ago`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return locale === "zh" ? `${minutes} 分钟前` : `${minutes}m ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 48) return locale === "zh" ? `${hours} 小时前` : `${hours}h ago`;
	const days = Math.round(hours / 24);
	return locale === "zh" ? `${days} 天前` : `${days}d ago`;
}
