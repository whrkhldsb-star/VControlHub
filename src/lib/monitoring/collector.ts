import { readFileSync, readdirSync, statfsSync } from "node:fs";
import os from "os";

function readProc(path: string) {
	try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

function formatBytes(bytes: number) {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let index = 0;
	let size = bytes;
	while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
	return `${size.toFixed(1)} ${units[index]}`;
}

function cpuUsagePercent() {
	const line = readProc("/proc/stat").split("\n")[0];
	if (!line?.startsWith("cpu ")) return "N/A";
	const parts = line.trim().split(/\s+/).map(Number);
	const idle = parts[4]! + (parts[5] || 0);
	const total = parts.slice(1).reduce((sum, value) => sum + value, 0);
	return total > 0 ? (((total - idle) / total) * 100).toFixed(1) : "N/A";
}

function topProcesses() {
	const processes: Array<{ pid: number; memKb: number; cmd: string; utime: number; stime: number }> = [];
	try {
		const totalMemKb = Math.max(os.totalmem() / 1024, 1);
		const cpuDenominator = Math.max(os.uptime() * Math.max(os.cpus().length, 1), 1);
		for (const entry of readdirSync("/proc")) {
			const pid = Number(entry);
			if (!pid || pid <= 0) continue;
			try {
				const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
				const open = stat.indexOf("(");
				const close = stat.lastIndexOf(")");
				if (open === -1 || close === -1) continue;
				const fields = stat.slice(close + 2).trim().split(/\s+/);
				if (fields.length < 22) continue;
				const utime = Number(fields[11]);
				const stime = Number(fields[12]);
				const rss = Number(fields[21]);
				if (![utime, stime, rss].every(Number.isFinite)) continue;
				processes.push({ pid, memKb: rss * 4, cmd: stat.slice(open + 1, close).slice(0, 40), utime, stime });
			} catch { continue; }
			if (processes.length > 200) break;
		}
		return processes.sort((a, b) => b.memKb - a.memKb).slice(0, 5).map((process) => ({
			pid: String(process.pid),
			cpu: Math.min(100, Math.max(0, ((process.utime + process.stime) / 100 / cpuDenominator) * 100)).toFixed(1),
			mem: `${((process.memKb / totalMemKb) * 100).toFixed(1)}%`,
			cmd: process.cmd,
		}));
	} catch { return []; }
}

function tcpConnectionCount() {
	const tcp = readProc("/proc/net/tcp");
	if (!tcp) return 0;
	return tcp.split("\n").slice(1).filter((line) => line.trim().split(/\s+/)[3] === "01").length;
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
		cpu: { model: cpus[0]?.model || "Unknown", cores: cpus.length, usage: `${cpuUsagePercent()}%`, loadAvg: os.loadavg().map((value) => value.toFixed(2)) },
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
