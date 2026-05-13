/**
 * Server monitoring API — CPU, memory, disk, uptime, network stats.
 * GET /api/monitoring/stats
 * Requires authenticated session.
 *
 * Pure Node.js + /proc filesystem reads — zero child_process calls,
 * zero injection risk, zero subprocess overhead.
 */
import { NextResponse } from "next/server";
import { readFileSync, statfsSync } from "node:fs";
import os from "os";
import { requireApiSession, isSessionPayload } from "@/lib/auth/api-session";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api:monitoring:stats");

/** Safely read a /proc file, returning empty string on failure */
function readProc(path: string): string {
	try { return readFileSync(path, "utf-8"); } catch { return ""; }
}

export async function GET() {
	const session = await requireApiSession();
	if (!isSessionPayload(session)) return session; // 401 response
	try {
		const cpus = os.cpus();
		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const uptime = os.uptime();

		// CPU usage — parse /proc/stat
		const cpuUsage = getCpuUsagePercent();

		// Load averages
		const loadAvg = os.loadavg();

		// Disk usage — statfs (pure Node.js, no subprocess)
		let diskInfo = "N/A";
		try {
			const stats = statfsSync("/");
			const totalDisk = stats.blocks * stats.bsize;
			const freeDisk = stats.bfree * stats.bsize;
			const usedDisk = totalDisk - freeDisk;
			const usedPercent = totalDisk > 0 ? ((usedDisk / totalDisk) * 100).toFixed(0) : "0";
			diskInfo = `${formatBytes(totalDisk)}/${formatBytes(usedDisk)} (${usedPercent}% used)`;
		} catch { /* ok */ }

		// Network stats — read /proc/net/dev directly
		let netInfo: { iface: string; rx: string; tx: string }[] = [];
		const netDev = readProc("/proc/net/dev");
		if (netDev) {
			for (const line of netDev.split("\n").slice(2)) {
				const parts = line.trim().split(/\s+/);
				if (parts.length >= 10 && !parts[0].startsWith("lo:")) {
					netInfo.push({
						iface: parts[0].replace(":", ""),
						rx: formatBytes(Number(parts[1])),
						tx: formatBytes(Number(parts[9])),
					});
				}
			}
		}

		// Top processes — read /proc/[pid]/stat directly (no ps subprocess)
		const topProcs = getTopProcesses();

		// Active TCP connections — read /proc/net/tcp directly
		const tcpConns = getTcpConnectionCount();

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
			tcpConnections: String(tcpConns),
			timestamp: new Date().toISOString(),
		});
	} catch (error) {
		logger.error("获取监控数据失败", error);
		return NextResponse.json({ error: "获取监控数据失败" }, { status: 500 });
	}
}

/** Parse /proc/stat to get CPU usage percentage */
function getCpuUsagePercent(): string {
	const stat = readProc("/proc/stat");
	const line = stat.split("\n")[0];
	if (!line?.startsWith("cpu ")) return "N/A";
	const parts = line.trim().split(/\s+/).map(Number);
	const idle = parts[4] + (parts[5] || 0);
	const total = parts.slice(1).reduce((a, b) => a + b, 0);
	if (total === 0) return "N/A";
	const used = total - idle;
	return ((used / total) * 100).toFixed(1);
}

/** Get top 5 processes by reading /proc/[pid]/stat directly */
function getTopProcesses(): { pid: string; cpu: string; mem: string; cmd: string }[] {
	const procs: { pid: number; memKb: number; cmd: string; utime: number; stime: number }[] = [];
	try {
		const { readdirSync } = require("node:fs");
		const entries = readdirSync("/proc");
		const clockTick = 100; // CLK_TCK on Linux, typically 100

		for (const entry of entries) {
			const pid = Number(entry);
			if (!pid || pid <= 0) continue;
			try {
				const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
				// Format: pid (comm) state ppid pgrp session tty_nr tpgid flags ...
				// Field indices (0-based after split): 0=pid, 1=comm, 2=state, 
				// 11=utime, 12=stime, 23=rss (pages)
				const match = stat.match(/^\d+\s+\(([^)]+)\)\s+\w\s+(-?\d+\s+){8}(\d+)\s+(\d+)\s+(?:-?\d+\s+){10}(\d+)/);
				if (!match) continue;
				const [, cmd, utimeStr, stimeStr, rssStr] = match;
				const utime = Number(utimeStr);
				const stime = Number(stimeStr);
				const rss = Number(rssStr); // in pages
				const memKb = rss * (4096 / 1024); // page size 4096 → KB
				procs.push({ pid, memKb, cmd: cmd.slice(0, 40), utime, stime });
			} catch { continue; }
			if (procs.length > 200) break; // safety limit
		}

		// Sort by memory usage (descending), take top 5
		procs.sort((a, b) => b.memKb - a.memKb);
		const top5 = procs.slice(0, 5);
		return top5.map((p) => ({
			pid: String(p.pid),
			cpu: ((p.utime + p.stime) / clockTick).toFixed(1),
			mem: `${p.memKb.toFixed(0)}M`,
			cmd: p.cmd,
		}));
	} catch {
		return [];
	}
}

/** Count established TCP connections from /proc/net/tcp */
function getTcpConnectionCount(): number {
	const tcp = readProc("/proc/net/tcp");
	if (!tcp) return 0;
	let count = 0;
	for (const line of tcp.split("\n").slice(1)) {
		const parts = line.trim().split(/\s+/);
		if (parts.length >= 4 && parts[3] === "01") count++;
	}
	return count;
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
