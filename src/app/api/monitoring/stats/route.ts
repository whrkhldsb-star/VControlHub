/**
 * Server monitoring API — CPU, memory, disk, uptime, network stats.
 * GET /api/monitoring/stats
 * Requires authenticated session.
 */
import { NextResponse } from "next/server";
import { execSync } from "child_process";
import os from "os";
import { requireApiSession, isSessionPayload } from "@/lib/auth/api-session";

export async function GET() {
	const session = await requireApiSession();
	if (!isSessionPayload(session)) return session; // 401 response
	try {
		const cpus = os.cpus();
		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const uptime = os.uptime();

		// CPU usage per core (1-second sample)
		let cpuUsage = "N/A";
		try {
			cpuUsage = execSync("top -bn1 | grep 'Cpu(s)' | awk '{print $2}'", { timeout: 5000, encoding: "utf-8" }).trim();
		} catch { /* ok */ }

		// Load averages
		const loadAvg = os.loadavg();

		// Disk usage
		let diskInfo = "N/A";
		try {
			diskInfo = execSync("df -h / | tail -1 | awk '{print $2\"/\"$3\" (\"$5\" used)\"}'", { timeout: 5000, encoding: "utf-8" }).trim();
		} catch { /* ok */ }

		// Network stats
		let netInfo: { iface: string; rx: string; tx: string }[] = [];
		try {
			const out = execSync("cat /proc/net/dev | tail -n +3", { timeout: 5000, encoding: "utf-8" });
			for (const line of out.split("\n").filter(Boolean)) {
				const parts = line.trim().split(/\s+/);
				if (parts.length >= 10 && !parts[0].startsWith("lo:")) {
					netInfo.push({
						iface: parts[0].replace(":", ""),
						rx: formatBytes(Number(parts[1])),
						tx: formatBytes(Number(parts[9])),
					});
				}
			}
		} catch { /* ok */ }

		// Top processes
		let topProcs: { pid: string; cpu: string; mem: string; cmd: string }[] = [];
		try {
			const out = execSync("ps aux --sort=-%mem | head -6 | tail -5", { timeout: 5000, encoding: "utf-8" });
			for (const line of out.split("\n").filter(Boolean)) {
				const parts = line.trim().split(/\s+/);
				if (parts.length >= 11) {
					topProcs.push({ pid: parts[1], cpu: parts[2], mem: parts[3], cmd: parts.slice(10).join(" ").slice(0, 40) });
				}
			}
		} catch { /* ok */ }

		// Active TCP connections
		let tcpConns = "N/A";
		try {
			tcpConns = execSync("ss -t -H | wc -l", { timeout: 3000, encoding: "utf-8" }).trim();
		} catch { /* ok */ }

		return NextResponse.json({
			hostname: os.hostname(),
			platform: os.platform(),
			arch: os.arch(),
			uptime: formatUptime(uptime),
			cpu: {
				model: cpus[0]?.model || "Unknown",
				cores: cpus.length,
				usage: `${cpuUsage}%`,
				loadAvg: loadAvg.map((v) => v.toFixed(2)),
			},
			memory: {
				total: formatBytes(totalMem),
				used: formatBytes(totalMem - freeMem),
				free: formatBytes(freeMem),
				usagePercent: (((totalMem - freeMem) / totalMem) * 100).toFixed(1),
			},
			disk: diskInfo,
			network: netInfo,
			topProcesses: topProcs,
			tcpConnections: tcpConns,
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		console.error("[monitoring/stats]", error);
		return NextResponse.json({ error: "获取监控数据失败" }, { status: 500 });
	}
}

function formatBytes(bytes: number): string {
	const units = ["B", "KB", "MB", "GB", "TB"];
	let i = 0;
	let size = bytes;
	while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
	return `${size.toFixed(1)} ${units[i]}`;
}

function formatUptime(seconds: number): string {
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	return `${d}天 ${h}时 ${m}分`;
}
