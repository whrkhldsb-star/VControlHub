/**
 * SSE stream for real-time monitoring stats.
 * GET /api/monitoring/stream
 *
 * Client connects via EventSource("/api/monitoring/stream").
 * Server pushes a "stats" event every `intervalSeconds`
 * (default 5, query-param configurable 2–30).
 *
 * Why SSE over WebSocket:
 *  - Unidirectional (server → client) — monitoring is pure read.
 *  - Auto-reconnect built into EventSource.
 *  - HTTP-only: works behind Caddy/Cloudflare without WS upgrade.
 *  - Each event is a discrete JSON payload — no framing protocol.
 *
 * The /proc collection logic is shared with ../stats/route.ts
 * (same module-level helpers). Keep them in sync until a shared
 * module is extracted.
 */

import { readFileSync, readdirSync, statfsSync } from "node:fs";
import os from "os";

import { withApiRoute } from "@/lib/http/api-guard";

const MAX_SSE_CONNECTIONS_PER_USER = 3;
const MAX_SSE_CONNECTION_AGE_MS = 30 * 60_000;
const activeConnectionsByUser = new Map<string, number>();

// ---- Shared /proc helpers (mirror of ../stats/route.ts) ----

function readProc(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function getCpuUsagePercent(): string {
  const stat = readProc("/proc/stat");
  const line = stat.split("\n")[0];
  if (!line?.startsWith("cpu ")) return "N/A";
  const parts = line.trim().split(/\s+/).map(Number);
  const idle = parts[4]! + (parts[5] || 0);
  const total = parts.slice(1).reduce((a: number, b: number) => a + b, 0);
  if (total === 0) return "N/A";
  const used = total - idle;
  return ((used / total) * 100).toFixed(1);
}

function getTopProcesses(): { pid: string; cpu: string; mem: string; cmd: string }[] {
  const procs: { pid: number; memKb: number; cmd: string; utime: number; stime: number }[] = [];
  try {
    const entries = readdirSync("/proc");
    const clockTick = 100;
    const totalMemKb = Math.max(os.totalmem() / 1024, 1);
    const processCpuDenominator = Math.max(os.uptime() * Math.max(os.cpus().length, 1), 1);
    for (const entry of entries) {
      const pid = Number(entry);
      if (!pid || pid <= 0) continue;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
        const openParenIndex = stat.indexOf("(");
        const closeParenIndex = stat.lastIndexOf(")");
        if (openParenIndex === -1 || closeParenIndex === -1) continue;
        const cmd = stat.slice(openParenIndex + 1, closeParenIndex);
        const fieldsFromState = stat.slice(closeParenIndex + 2).trim().split(/\s+/);
        if (fieldsFromState.length < 22) continue;
        const utime = Number(fieldsFromState[11]);
        const stime = Number(fieldsFromState[12]);
        const rss = Number(fieldsFromState[21]);
        if (![utime, stime, rss].every(Number.isFinite)) continue;
        const memKb = rss * (4096 / 1024);
        procs.push({ pid, memKb, cmd: cmd.slice(0, 40), utime, stime });
      } catch { continue; }
      if (procs.length > 200) break;
    }
    procs.sort((a, b) => b.memKb - a.memKb);
    return procs.slice(0, 5).map((proc) => {
      const cpuSeconds = (proc.utime + proc.stime) / clockTick;
      const cpuPercent = Math.min(100, Math.max(0, (cpuSeconds / processCpuDenominator) * 100));
      return {
        pid: String(proc.pid),
        cpu: cpuPercent.toFixed(1),
        mem: `${((proc.memKb / totalMemKb) * 100).toFixed(1)}%`,
        cmd: proc.cmd,
      };
    });
  } catch { return []; }
}

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
  return `${d}d  ${h}h ${m}m`;
}

function collectStats() {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpuUsage = getCpuUsagePercent();
  const loadAvg = os.loadavg();
  let diskInfo = "N/A";
  try {
    const stats = statfsSync("/");
    const totalDisk = stats.blocks * stats.bsize;
    const freeDisk = stats.bfree * stats.bsize;
    const usedDisk = totalDisk - freeDisk;
    const usedPercent = totalDisk > 0 ? ((usedDisk / totalDisk) * 100).toFixed(0) : "0";
    diskInfo = `${formatBytes(usedDisk)}/${formatBytes(totalDisk)} (${usedPercent}% used)`;
  } catch { /* ok */ }
  const netInfo: { iface: string; rx: string; tx: string }[] = [];
  const netDev = readProc("/proc/net/dev");
  if (netDev) {
    for (const line of netDev.split("\n").slice(2)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 10 && !parts[0]!.startsWith("lo:")) {
        netInfo.push({ iface: parts[0]!.replace(":", ""), rx: formatBytes(Number(parts[1])), tx: formatBytes(Number(parts[9]!)) });
      }
    }
  }
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: formatUptime(os.uptime()),
    cpu: { model: cpus[0]?.model || "Unknown", cores: cpus.length, usage: `${cpuUsage}%`, loadAvg: loadAvg.map((v) => v.toFixed(2)) },
    memory: { total: formatBytes(totalMem), used: formatBytes(totalMem - freeMem), free: formatBytes(freeMem), usagePercent: (((totalMem - freeMem) / totalMem) * 100).toFixed(1) },
    disk: diskInfo,
    network: netInfo,
    topProcesses: getTopProcesses(),
    tcpConnections: String(getTcpConnectionCount()),
    timestamp: new Date().toISOString(),
  };
}

// ---- SSE Route ----

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { requireAuth: true, errorMessage: "Monitoring SSE AuthenticationFailed", rateLimit: { maxRequests: 30, windowMs: 60_000 } },
    async ({ session }) => {
			const userId = session!.userId;
			const activeCount = activeConnectionsByUser.get(userId) ?? 0;
			if (activeCount >= MAX_SSE_CONNECTIONS_PER_USER) {
				return Response.json({ error: "Too many active monitoring streams" }, { status: 429 });
			}
			activeConnectionsByUser.set(userId, activeCount + 1);
      const url = new URL(request.url);
      const intervalSeconds = Math.max(2, Math.min(30, Number(url.searchParams.get("interval")) || 5));
			let released = false;
			let timer: ReturnType<typeof setInterval> | undefined;
			let keepAlive: ReturnType<typeof setInterval> | undefined;
			let maxAgeTimer: ReturnType<typeof setTimeout> | undefined;
			const release = () => {
				if (released) return;
				released = true;
				if (timer) clearInterval(timer);
				if (keepAlive) clearInterval(keepAlive);
				if (maxAgeTimer) clearTimeout(maxAgeTimer);
				const current = activeConnectionsByUser.get(userId) ?? 1;
				if (current <= 1) activeConnectionsByUser.delete(userId);
				else activeConnectionsByUser.set(userId, current - 1);
			};

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();

          function sendEvent(event: string, data: unknown) {
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            } catch {
						release();
            }
          }

          // Send initial snapshot immediately.
          sendEvent("stats", collectStats());

				timer = setInterval(() => {
            sendEvent("stats", collectStats());
          }, intervalSeconds * 1000);

          // Keep-alive comment every 15s to prevent idle proxy close.
				keepAlive = setInterval(() => {
            try {
              controller.enqueue(encoder.encode(":keep-alive\n\n"));
            } catch {
						release();
            }
          }, 15_000);

          // Client disconnected → clean up.
          request.signal.addEventListener("abort", () => {
					release();
            try { controller.close(); } catch { /* already closed */ }
          }, { once: true });

					maxAgeTimer = setTimeout(() => {
						release();
						try { controller.close(); } catch { /* already closed */ }
					}, MAX_SSE_CONNECTION_AGE_MS);
        },
			cancel() {
				release();
			},
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no", // nginx/Caddy: disable proxy buffering
        },
      });
    },
  );
}
