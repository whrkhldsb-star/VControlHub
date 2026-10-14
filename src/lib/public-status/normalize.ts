/**
 * Turn one parsed monitor sample (`ServerMetrics`, from SSH or an Agent
 * report) into the plain numbers stored in `server_metric_latest`.
 *
 * Only numbers leave this module: no mount paths, no interface list beyond
 * the chosen primary interface name, no raw command output. Values that the
 * sample did not contain stay `null` — callers must not invent zeros.
 */
import type { ServerMetrics } from "@/lib/server/monitor";
import { selectPrimaryInterface } from "@/lib/monitoring/traffic";

export type NormalizedMetrics = {
	cpuUsage: number | null;
	cpuCores: number | null;
	load1: number | null;
	load5: number | null;
	load15: number | null;
	memUsage: number | null;
	memUsedMb: number | null;
	memTotalMb: number | null;
	swapUsage: number | null;
	diskUsage: number | null;
	diskUsedBytes: number | null;
	diskTotalBytes: number | null;
	uptimeSeconds: number | null;
	netIface: string | null;
	netRxBytes: bigint | null;
	netTxBytes: bigint | null;
};

const SIZE_UNITS: Record<string, number> = {
	B: 1,
	K: 1024,
	M: 1024 ** 2,
	G: 1024 ** 3,
	T: 1024 ** 4,
	P: 1024 ** 5,
};

/**
 * Parse a `df -h` size label ("50G", "1.5T", "512M", "0") into bytes.
 * `df -h` rounds and uses powers of 1024, so the result is approximate.
 */
export function parseDfSizeLabel(label: string | undefined | null): number | null {
	if (!label) return null;
	const match = /^(\d+(?:[.,]\d+)?)([BKMGTP])?i?B?$/i.exec(label.trim());
	if (!match) return null;
	const value = Number(match[1]!.replace(",", "."));
	if (!Number.isFinite(value)) return null;
	const unit = (match[2] ?? "B").toUpperCase();
	return Math.round(value * (SIZE_UNITS[unit] ?? 1));
}

/**
 * Parse the human `uptime` fragment kept by the monitor parser
 * ("3 days, 4:05", "1 day, 12 min", "45 min", "4:05", "2 days") or a full
 * `uptime` line into seconds. Returns null when the text has no recognisable
 * duration (e.g. a Windows Agent that reports a different format).
 */
export function parseUptimeSeconds(text: string | undefined | null): number | null {
	if (!text) return null;
	let fragment = text;
	const up = /\bup\s+(.+)/i.exec(fragment);
	if (up) fragment = up[1]!;
	// Drop everything from the user count / load average on.
	fragment = fragment.split(/,\s*\d+\s+users?\b|,?\s*load averages?:/i)[0]!;
	let seconds = 0;
	let matched = false;
	const days = /(\d+)\s*days?/i.exec(fragment);
	if (days) {
		seconds += Number(days[1]) * 86_400;
		matched = true;
	}
	const clock = /(\d{1,2}):(\d{2})(?!\d)/.exec(fragment);
	if (clock) {
		seconds += Number(clock[1]) * 3_600 + Number(clock[2]) * 60;
		matched = true;
	}
	const hours = /(\d+)\s*(?:hrs?|hours?)\b/i.exec(fragment);
	if (hours) {
		seconds += Number(hours[1]) * 3_600;
		matched = true;
	}
	const minutes = /(\d+)\s*min/i.exec(fragment);
	if (minutes) {
		seconds += Number(minutes[1]) * 60;
		matched = true;
	}
	const secs = /(\d+)\s*secs?\b/i.exec(fragment);
	if (secs) {
		seconds += Number(secs[1]);
		matched = true;
	}
	return matched ? seconds : null;
}

function finiteOrNull(value: number | undefined | null): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function percentOrNull(value: number | undefined | null): number | null {
	const n = finiteOrNull(value);
	return n === null ? null : Math.min(100, Math.max(0, n));
}

function counterOrNull(value: number | undefined): bigint | null {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
	return BigInt(Math.trunc(value));
}

export function normalizeServerMetrics(metrics: ServerMetrics): NormalizedMetrics {
	const rootDisk =
		metrics.disk.find((d) => d.mount === "/") ??
		metrics.disk.slice().sort((a, b) => b.usagePercent - a.usagePercent)[0];
	const diskMax = metrics.disk.length > 0 ? Math.max(...metrics.disk.map((d) => d.usagePercent)) : null;
	const primary = selectPrimaryInterface(metrics.network);
	const memTotal = metrics.memory.totalMb > 0 ? metrics.memory.totalMb : null;
	return {
		cpuUsage: percentOrNull(metrics.cpu.usagePercent),
		cpuCores: metrics.cpu.cores > 0 ? metrics.cpu.cores : null,
		load1: finiteOrNull(metrics.cpu.loadAvg[0]),
		load5: finiteOrNull(metrics.cpu.loadAvg[1]),
		load15: finiteOrNull(metrics.cpu.loadAvg[2]),
		memUsage: memTotal === null ? null : percentOrNull(metrics.memory.usagePercent),
		memUsedMb: memTotal === null ? null : Math.round(metrics.memory.usedMb),
		memTotalMb: memTotal,
		swapUsage: percentOrNull(metrics.swapUsagePercent),
		diskUsage: percentOrNull(diskMax),
		diskUsedBytes: parseDfSizeLabel(rootDisk?.usedGb),
		diskTotalBytes: parseDfSizeLabel(rootDisk?.totalGb),
		uptimeSeconds: parseUptimeSeconds(metrics.uptime),
		netIface: primary ? primary.iface.slice(0, 64) : null,
		netRxBytes: primary ? counterOrNull(primary.rxBytes) : null,
		netTxBytes: primary ? counterOrNull(primary.txBytes) : null,
	};
}
