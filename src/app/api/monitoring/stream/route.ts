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
const activeConnectionsByUser = new Map<string, number>();

// ---- SSE Route ----

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "health:read", errorMessage: "Monitoring SSE authentication failed", rateLimit: { maxRequests: 30, windowMs: 60_000 } },
    async ({ session }) => {
			const userId = session!.userId;
			const activeCount = activeConnectionsByUser.get(userId) ?? 0;
			if (activeCount >= MAX_SSE_CONNECTIONS_PER_USER) {
				return Response.json(
					{
						code: "RATE_LIMITED",
						message: "Too many active monitoring streams",
						error: "Too many active monitoring streams",
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
          sendEvent("stats", collectMonitoringStats());

				timer = setInterval(() => {
            sendEvent("stats", collectMonitoringStats());
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
