import { apiCopy } from "@/lib/i18n/api-copy";
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

import { withApiRoute } from "@/lib/http/api-guard";
import { collectMonitoringStats } from "@/lib/monitoring/collector";

const MAX_SSE_CONNECTIONS_PER_USER = 3;
const MAX_SSE_CONNECTION_AGE_MS = 30 * 60_000;
const MIN_COLLECT_INTERVAL_MS = 5_000;
const activeConnectionsByUser = new Map<string, number>();
type MonitoringStats = Awaited<ReturnType<typeof collectMonitoringStats>>;
let cachedStats: MonitoringStats | null = null;
let cachedStatsAt = 0;
let inflightStats: Promise<MonitoringStats> | null = null;

/**
 * Shared async sampler. Collection is now async (Windows spawns PowerShell /
 * netstat via execFile), so concurrent SSE connections share one in-flight
 * collection instead of each spawning their own child processes.
 */
function getSharedMonitoringStats(): Promise<MonitoringStats> {
  const now = Date.now();
  if (cachedStats && now - cachedStatsAt < MIN_COLLECT_INTERVAL_MS) {
    return Promise.resolve(cachedStats);
  }
  if (inflightStats) return inflightStats;
  inflightStats = collectMonitoringStats()
    .then((stats) => {
      cachedStats = stats;
      cachedStatsAt = Date.now();
      return stats;
    })
    .finally(() => {
      inflightStats = null;
    });
  return inflightStats;
}

// ---- SSE Route ----

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "health:read", errorMessage: apiCopy("apiCopy.monitoring.sse.authentication.failed.75339d30"), rateLimit: { maxRequests: 30, windowMs: 60_000 } },
    async ({ session }) => {
			const userId = session!.userId;
			const activeCount = activeConnectionsByUser.get(userId) ?? 0;
			if (activeCount >= MAX_SSE_CONNECTIONS_PER_USER) {
				return Response.json(
					{
						code: "RATE_LIMITED",
						message: apiCopy("apiCopy.too.many.active.monitoring.streams.f2c04de1"),
						error: apiCopy("apiCopy.too.many.active.monitoring.streams.f2c04de1"),
					},
					{ status: 429 },
				);
			}
			activeConnectionsByUser.set(userId, activeCount + 1);
      const url = new URL(request.url);
      const intervalSeconds = Math.max(2, Math.min(30, Number(url.searchParams.get("interval")) || 5));
			let released = false;
			let timer: ReturnType<typeof setInterval> | undefined;
			let keepAlive: ReturnType<typeof setInterval> | undefined;
			let maxAgeTimer: ReturnType<typeof setTimeout> | undefined;
			let onAbort: (() => void) | undefined;
			const release = () => {
				if (released) return;
				released = true;
				if (timer) clearInterval(timer);
				if (keepAlive) clearInterval(keepAlive);
				if (maxAgeTimer) clearTimeout(maxAgeTimer);
				if (onAbort) request.signal.removeEventListener("abort", onAbort);
				const current = activeConnectionsByUser.get(userId) ?? 1;
				if (current <= 1) activeConnectionsByUser.delete(userId);
				else activeConnectionsByUser.set(userId, current - 1);
			};

      const stream = new ReadableStream({
        start(controller) {
          const encoder = new TextEncoder();
          const close = () => {
            release();
            try { controller.close(); } catch { /* already closed */ }
          };
          onAbort = close;
          request.signal.addEventListener("abort", onAbort, { once: true });
          // Authorization can finish after the browser has already disconnected.
          if (request.signal.aborted) {
            close();
            return;
          }

          async function sendStats() {
            if (released || (controller.desiredSize ?? 0) <= 0) return;
            try {
              const data = await getSharedMonitoringStats();
              if (released || (controller.desiredSize ?? 0) <= 0) return;
              controller.enqueue(encoder.encode(`event: stats\ndata: ${JSON.stringify(data)}\n\n`));
            } catch (error) {
              release();
              // start() has already returned by the time an async collect
              // fails, so the consumer is signalled through the stream itself.
              try { controller.error(error); } catch { /* already closed */ }
            }
          }

          // Send initial snapshot immediately.
          void sendStats();

					timer = setInterval(() => {
            void sendStats();
          }, intervalSeconds * 1000);

          // Keep-alive comment every 15s to prevent idle proxy close.
				keepAlive = setInterval(() => {
            if (released || (controller.desiredSize ?? 0) <= 0) return;
            try {
              controller.enqueue(encoder.encode(":keep-alive\n\n"));
            } catch {
						release();
            }
          }, 15_000);

					maxAgeTimer = setTimeout(close, MAX_SSE_CONNECTION_AGE_MS);
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
