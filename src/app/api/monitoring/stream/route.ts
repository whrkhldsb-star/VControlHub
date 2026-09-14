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
let cachedStats: ReturnType<typeof collectMonitoringStats> | null = null;
let cachedStatsAt = 0;

function getSharedMonitoringStats() {
  const now = Date.now();
  if (!cachedStats || now - cachedStatsAt >= MIN_COLLECT_INTERVAL_MS) {
    cachedStats = collectMonitoringStats();
    cachedStatsAt = now;
  }
  return cachedStats;
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

          function sendStats(initial = false) {
            if (released || (controller.desiredSize ?? 0) <= 0) return;
            try {
              const data = getSharedMonitoringStats();
              controller.enqueue(encoder.encode(`event: stats\ndata: ${JSON.stringify(data)}\n\n`));
            } catch (error) {
              release();
              if (initial) throw error;
              try { controller.error(error); } catch { /* already closed */ }
            }
          }

          // Send initial snapshot immediately.
          sendStats(true);
          if (released) return;

				timer = setInterval(() => {
            sendStats();
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
