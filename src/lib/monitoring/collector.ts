import { readFileSync, readdirSync, statfsSync } from "node:fs";
import os from "os";

import { formatBytes } from "@/lib/format/bytes";

/**
 * Upper bound on /proc entries inspected per collection tick. The previous cap
 * was 200, which on a container host silently hid every process listed after the
 * 200th directory entry — including whatever was actually leaking memory, since
 * the "top 5" was then picked from an arbitrary prefix of the process table.
 */
const MAX_SCANNED_PROCESSES = 1024;

/** `getconf CLK_TCK` — 100 on every Linux target this ships to. */
const CLOCK_TICKS_PER_SECOND = 100;

/** /proc/[pid]/stat reports RSS in pages; Linux pages are 4 KiB on our targets. */
const PAGE_SIZE_KB = 4;

function readProc(path: string) {
	try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

export type CpuTotals = { total: number; idle: number };

/** Jiffies on the aggregate `cpu` line, plus the idle+iowait share of them. */
export function parseCpuTotals(procStat: string): CpuTotals | null {
	const line = procStat.split("\n")[0];
	if (!line?.startsWith("cpu ")) return null;
	const values = line.trim().split(/\s+/).slice(1).map(Number);
	if (values.length < 5 || !values.every(Number.isFinite)) return null;
	return {
		total: values.reduce((sum, value) => sum + value, 0),
		idle: values[3]! + values[4]!,
	};
}

/** Busy share of a jiffy window, formatted the way the UI prints it. */
export function cpuBusyPercent(totalJiffies: number, idleJiffies: number) {
	if (!(totalJiffies > 0)) return "N/A";
	const busy = Math.min(Math.max(totalJiffies - idleJiffies, 0), totalJiffies);
	return ((busy / totalJiffies) * 100).toFixed(1);
}

/**
 * /proc/stat counters are cumulative since boot, so a single read describes the
 * host's whole uptime — a number that moves by less than 0.1% between two ticks.
 * The monitoring page renders this as a live gauge refreshed every 5 seconds
 * (see api/monitoring/stream), where a boot average reads as a frozen dial. So
 * each call diffs against the previous read; only the first sample of the
 * process lifetime falls back to the boot average, because a one-shot GET
 * /api/monitoring/stats has nothing else to report.
 */
let previousCpuTotals: CpuTotals | null = null;
let lastCpuPercent = "N/A";

function cpuUsagePercent() {
	const current = parseCpuTotals(readProc("/proc/stat"));
	if (!current) return lastCpuPercent;
	const previous = previousCpuTotals;
	if (!previous) {
		previousCpuTotals = current;
		lastCpuPercent = cpuBusyPercent(current.total, current.idle);
		return lastCpuPercent;
	}
	const totalDelta = current.total - previous.total;
	// Two calls inside the same jiffy have nothing to measure: keep the older
	// baseline so the next call still diffs over a usable window.
	if (totalDelta <= 0) return lastCpuPercent;
	previousCpuTotals = current;
	lastCpuPercent = cpuBusyPercent(totalDelta, current.idle - previous.idle);
	return lastCpuPercent;
}

/** The UI prints this verbatim, so an unavailable reading must not become "N/A%". */
function formatCpuUsage(percent: string) {
	return percent === "N/A" ? percent : `${percent}%`;
}

/** Reset the CPU-delta baseline. Test-only. */
export function __resetCpuBaselineForTests() {
	previousCpuTotals = null;
	lastCpuPercent = "N/A";
}

export type ProcessStat = { memKb: number; cmd: string; cpuPercent: number };

/**
 * Parse one /proc/[pid]/stat line. `comm` may contain spaces and parentheses, so
 * the numeric fields are counted from the last `)`: index = field number - 3.
 *
 * `cpuPercent` is the share of the whole host's CPU capacity the process has used
 * over *its own* lifetime — the same "fraction of the box" reading as the MEM%
 * column beside it. The denominator used to be the host's entire uptime, so a
 * worker started a minute ago that was pinning a core reported ~0%.
 */
export function parseProcessStat(
	stat: string,
	hostUptimeSeconds: number,
	cores: number,
): ProcessStat | null {
	const open = stat.indexOf("(");
	const close = stat.lastIndexOf(")");
	if (open === -1 || close === -1 || close < open) return null;
	const fields = stat.slice(close + 2).trim().split(/\s+/);
	if (fields.length < 22) return null;
	const utime = Number(fields[11]);
	const stime = Number(fields[12]);
	const startTicks = Number(fields[19]);
	const rss = Number(fields[21]);
	if (![utime, stime, startTicks, rss].every(Number.isFinite)) return null;
	const lifetimeSeconds = Math.max(
		hostUptimeSeconds - startTicks / CLOCK_TICKS_PER_SECOND,
		1,
	);
	const cpuSeconds = (utime + stime) / CLOCK_TICKS_PER_SECOND;
	const capacitySeconds = lifetimeSeconds * Math.max(cores, 1);
	return {
		memKb: rss * PAGE_SIZE_KB,
		cmd: stat.slice(open + 1, close).slice(0, 40),
		cpuPercent: Math.min(100, Math.max(0, (cpuSeconds / capacitySeconds) * 100)),
	};
}

function topProcesses() {
	const processes: Array<ProcessStat & { pid: number }> = [];
	try {
		const totalMemKb = Math.max(os.totalmem() / 1024, 1);
		const uptime = os.uptime();
		const cores = os.cpus().length;
		for (const entry of readdirSync("/proc")) {
			const pid = Number(entry);
			if (!pid || pid <= 0) continue;
			try {
				const parsed = parseProcessStat(
					readFileSync(`/proc/${pid}/stat`, "utf-8"),
					uptime,
					cores,
				);
				if (parsed) processes.push({ pid, ...parsed });
			} catch { continue; }
			if (processes.length >= MAX_SCANNED_PROCESSES) break;
		}
		return processes.sort((a, b) => b.memKb - a.memKb).slice(0, 5).map((process) => ({
			pid: String(process.pid),
			cpu: process.cpuPercent.toFixed(1),
			mem: `${((process.memKb / totalMemKb) * 100).toFixed(1)}%`,
			cmd: process.cmd,
		}));
	} catch { return []; }
}

/** Sockets in state `01` (ESTABLISHED) in a /proc/net/tcp{,6} table. */
export function countEstablishedSockets(table: string) {
	return table
		.split("\n")
		.slice(1)
		.filter((line) => line.trim().split(/\s+/)[3] === "01").length;
}

function tcpConnectionCount() {
	// IPv6 sockets live in their own table: counting only /proc/net/tcp reported
	// a near-empty connection list on a dual-stack host served over IPv6.
	return (
		countEstablishedSockets(readProc("/proc/net/tcp")) +
		countEstablishedSockets(readProc("/proc/net/tcp6"))
	);
}

function diskInfo() {
	try {
		const stats = statfsSync("/");
		const total = stats.blocks * stats.bsize;
		const used = total - stats.bfree * stats.bsize;
		const percentage = total > 0 ? ((used / total) * 100).toFixed(0) : "0";
		return `${formatBytes(used)}/${formatBytes(total)} (${percentage}% used)`;
	} catch { return "N/A"; }
}

function networkInfo() {
	const rows: Array<{ iface: string; rx: string; tx: string }> = [];
	for (const line of readProc("/proc/net/dev").split("\n").slice(2)) {
		const parts = line.trim().split(/\s+/);
		if (parts.length >= 10 && !parts[0]!.startsWith("lo:")) {
			rows.push({ iface: parts[0]!.replace(":", ""), rx: formatBytes(Number(parts[1])), tx: formatBytes(Number(parts[9])) });
		}
	}
	return rows;
}

export function collectMonitoringStats() {
	const cpus = os.cpus();
	const totalMem = os.totalmem();
	const freeMem = os.freemem();
	const uptime = os.uptime();
	return {
		hostname: os.hostname(),
		platform: os.platform(),
		arch: os.arch(),
		uptime: `${Math.floor(uptime / 86400)}d  ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
		cpu: { model: cpus[0]?.model || "Unknown", cores: cpus.length, usage: formatCpuUsage(cpuUsagePercent()), loadAvg: os.loadavg().map((value) => value.toFixed(2)) },
		memory: {
			total: formatBytes(totalMem),
			used: formatBytes(totalMem - freeMem),
			free: formatBytes(freeMem),
			usagePercent: (((totalMem - freeMem) / totalMem) * 100).toFixed(1),
		},
		disk: diskInfo(),
		network: networkInfo(),
		topProcesses: topProcesses(),
		tcpConnections: String(tcpConnectionCount()),
		timestamp: new Date().toISOString(),
	};
}
