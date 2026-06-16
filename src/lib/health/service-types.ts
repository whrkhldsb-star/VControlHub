/**
 * Health service — types, constants, and pure helpers (R28 god-file split).
 *
 * No prisma, no I/O. Imports nothing but `ServerMetrics` (a server-side
 * type) so the classification thresholds can be re-evaluated by the
 * collectors / alert evaluators.
 */
import type { ServerMetrics } from "@/lib/server/monitor";

export type HealthStatus =
	| "healthy"
	| "warning"
	| "critical"
	| "offline"
	| "unknown";

export type ServerHealth = {
	serverId: string;
	serverName: string;
	host: string;
	enabled: boolean;
	status: HealthStatus;
	cpu?: number;
	mem?: number;
	diskMax?: number;
	uptime?: string;
	/** RTT of the lightweight TCP probe that ran before the SSH pull.
	 *  Present whenever the probe succeeded (status !== "offline" due to
	 *  network error). Absent for disabled servers and for the "host up
	 *  but never reached by probe" historical records. */
	latencyMs?: number;
	lastCheck: string;
	metrics?: ServerMetrics;
	error?: string;
};

export type HealthOverview = {
	total: number;
	online: number;
	warning: number;
	critical: number;
	offline: number;
	servers: ServerHealth[];
};

/* ── Thresholds ───────────────────────────────────────────── */

export const WARN_CPU = 80;
export const CRIT_CPU = 95;
export const WARN_MEM = 85;
export const CRIT_MEM = 95;
export const WARN_DISK = 85;
export const CRIT_DISK = 95;

export function evaluateHealth(metrics: ServerMetrics): HealthStatus {
	const cpu = metrics.cpu.usagePercent;
	const mem = metrics.memory.usagePercent;
	const diskMax = Math.max(...metrics.disk.map((d) => d.usagePercent), 0);

	if (cpu >= CRIT_CPU || mem >= CRIT_MEM || diskMax >= CRIT_DISK)
		return "critical";
	if (cpu >= WARN_CPU || mem >= WARN_MEM || diskMax >= WARN_DISK)
		return "warning";
	return "healthy";
}

/* ── Silence window helper ────────────────────────────────── */

const SILENCE_WINDOW_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)-([01]\d|2[0-3]):([0-5]\d)$/;

export function isNowInAlertSilenceWindow(windows: readonly string[], now: Date = new Date()): boolean {
	if (windows.length === 0) return false;
	const currentMinutes = now.getHours() * 60 + now.getMinutes();
	for (const window of windows) {
		const match = SILENCE_WINDOW_PATTERN.exec(window);
		if (!match) continue;
		const start = Number(match[1]) * 60 + Number(match[2]);
		const end = Number(match[3]) * 60 + Number(match[4]);
		if (start === end) return true;
		if (start < end) {
			if (currentMinutes >= start && currentMinutes < end) return true;
		} else if (currentMinutes >= start || currentMinutes < end) {
			return true;
		}
	}
	return false;
}
