import { execRemoteCommand, buildSshParamsFromServer } from "@/lib/ssh/client";
import { prisma } from "@/lib/db";

/* ── Types ────────────────────────────────────────────────── */

export type ServerMetrics = {
	cpu: { usagePercent: number; cores: number; loadAvg: [number, number, number] };
	memory: { totalMb: number; usedMb: number; availableMb: number; usagePercent: number };
	disk: Array<{ mount: string; totalGb: string; usedGb: string; usagePercent: number }>;
	network: Array<{ iface: string; rxBytes: number; txBytes: number }>;
	uptime: string;
	timestamp: string;
};

export type MonitorError = { error: string; serverId: string };

const MONITOR_SCRIPT = `echo "===CPU==="; nproc 2>/dev/null || echo 1; cat /proc/loadavg 2>/dev/null || echo "0 0 0"; awk '/^cpu /{idle=$5+$6; total=0; for(i=2;i<=NF;i++) total+=$i; print idle,total; exit}' /proc/stat 2>/dev/null || echo "0 0"; echo "===MEM==="; awk '/MemTotal:/{t=$2} /MemAvailable:/{a=$2} END{if(t>0){printf "%d %d %d\\n", t/1024, (t-a)/1024, a/1024}else{print "0 0 0"}}' /proc/meminfo 2>/dev/null || echo "0 0 0"; echo "===DISK==="; df -h --output=size,used,pcent,target -x tmpfs -x devtmpfs -x squashfs 2>/dev/null | tail -n +2 || df -h 2>/dev/null | tail -n +2; echo "===LOAD==="; uptime 2>/dev/null || echo "unknown"; echo "===NET==="; awk 'NR>2 && $1!="lo:" {gsub(/:/,"",$1); print $1,$2,$10}' /proc/net/dev 2>/dev/null | head -5 || echo ""`;

/* ── Parse helpers ────────────────────────────────────────── */

function parseFloatOr(val: string, fallback: number): number {
	const n = parseFloat(val);
	return Number.isNaN(n) ? fallback : n;
}

function parseCpuSection(lines: string[]): ServerMetrics["cpu"] {
	const cores = parseInt(lines[0] || "1", 10) || 1;
	const loadParts = (lines[1] || "0 0 0").trim().split(/\s+/);
	const loadAvg: [number, number, number] = [
		parseFloatOr(loadParts[0]!, 0),
		parseFloatOr(loadParts[1]!, 0),
		parseFloatOr(loadParts[2]!, 0),
	];
	const cpuParts = (lines[2] || "0 0").trim().split(/\s+/);
	const idleTicks = parseFloatOr(cpuParts[0]!, 0);
	const totalTicks = parseFloatOr(cpuParts[1]!, 0);
	const usagePercent = totalTicks > 0 ? Math.round((1 - idleTicks / totalTicks) * 1000) / 10 : parseFloatOr(lines[2] || "0", 0);
	return { usagePercent: Math.min(100, Math.max(0, usagePercent)), cores, loadAvg };
}

function parseMemSection(line: string): ServerMetrics["memory"] {
	const parts = line.trim().split(/\s+/);
	const totalMb = parseFloatOr(parts[0]!, 0);
	const usedMb = parseFloatOr(parts[1]!, 0);
	const availableMb = parseFloatOr(parts[2]!, 0);
	const usagePercent = totalMb > 0 ? Math.round((usedMb / totalMb) * 1000) / 10 : 0;
	return { totalMb: Math.round(totalMb), usedMb: Math.round(usedMb), availableMb: Math.round(availableMb), usagePercent };
}

function parseDiskSection(lines: string[]): ServerMetrics["disk"] {
	return lines
		.filter((l) => l.trim())
		.map((line) => {
			const parts = line.trim().split(/\s+/);
			if (parts.length < 4) return null;
			return {
				mount: parts[parts.length - 1]!,
				totalGb: parts[0]!,
				usedGb: parts[1]!,
				usagePercent: parseFloatOr(parts[2]!.replace("%", ""), 0),
			};
		})
		.filter(Boolean) as ServerMetrics["disk"];
}

function parseNetSection(lines: string[]): ServerMetrics["network"] {
	return lines
		.filter((l) => l.trim())
		.map((line) => {
			const parts = line.trim().split(/\s+/);
			if (parts.length < 3) return null;
			return { iface: parts[0]!, rxBytes: parseFloatOr(parts[1]!, 0), txBytes: parseFloatOr(parts[2]!, 0) };
		})
		.filter(Boolean) as ServerMetrics["network"];
}

function parseUptime(line: string): string {
	const match = line.match(/up\s+(.+?),\s*\d+\s*user/);
	return match ? match[1].trim() : line.trim();
}

/* ── Main collect function ────────────────────────────────── */

function splitSection(output: string, marker: string): string[] {
	const start = output.indexOf(marker);
	if (start === -1) return [];
	const afterMarker = output.slice(start + marker.length);
	const nextSection = afterMarker.search(/===\w+===/);
	const section = nextSection > 0 ? afterMarker.slice(0, nextSection) : afterMarker;
	return section.split("\n").filter((l) => l.trim());
}

export function parseMonitorScriptOutput(stdout: string): ServerMetrics {
	const cpu = parseCpuSection(splitSection(stdout, "===CPU==="));
	const memLine = splitSection(stdout, "===MEM===").join(" ");
	const memory = parseMemSection(memLine);
	const disk = parseDiskSection(splitSection(stdout, "===DISK==="));
	const netLines = splitSection(stdout, "===NET===");
	const network = parseNetSection(netLines);
	const uptimeLine = splitSection(stdout, "===LOAD===").join(" ");
	const uptime = parseUptime(uptimeLine);

	return {
		cpu,
		memory,
		disk,
		network,
		uptime,
		timestamp: new Date().toISOString(),
	};
}

export async function collectServerMetrics(serverId: string): Promise<ServerMetrics | MonitorError> {
	try {
		const server = await prisma.server.findUnique({
			where: { id: serverId },
			include: { sshKey: { select: { privateKey: true } } },
		});

		if (!server) return { error: "服务器不存在", serverId };
		if (!server.enabled) return { error: "服务器已停用", serverId };

		const sshParams = await buildSshParamsFromServer(server, server.sshKey);
		const { stdout, exitCode } = await execRemoteCommand({ ...sshParams, command: MONITOR_SCRIPT, timeout: 15_000 });

		if (exitCode !== 0 && !stdout) {
			return { error: "SSH 命令执行失败", serverId };
		}

		return parseMonitorScriptOutput(stdout);
	} catch (err) {
		const message = err instanceof Error ? err.message : "未知错误";
		return { error: `连接失败: ${message}`, serverId };
	}
}
