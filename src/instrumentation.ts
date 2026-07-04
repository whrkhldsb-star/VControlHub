/**
 * Next.js instrumentation hook — single entry point for server-side bootstrap.
 *
 * Responsibilities (in order):
 *   1. Sentry server-side init (APM / error tracking).
 *   2. BigInt JSON serialization patch (must load before any JSON.stringify
 *      touches a prisma BigInt column).
 *   3. TR-001 T13c — start every durable-job worker via the centralised
 *      lifecycle orchestrator. Previously workers were started in
 *      `src/server.ts`; moving here means future `next start` deployments
 *      (without the custom server) still get all 8 workers.
 *   4. TR-051 — verify ADMIN_INITIAL_PASSWORD (env) matches the DB hash;
 *      log-only, never throws (don't lock out production on bootstrap).
 *   5. TR-002 R4 — fire-and-forget probe of the direct gateway public-port
 *      exposure; warns the operator if 31888 is reachable from the public IP.
 *
 * Test mode: VITEST / NODE_ENV=test is detected inside
 * `startWorkerLifecycle()` and short-circuits before any worker timers
 * are armed.
 *
 * History: commit 8ec51ae (Sentry integration) accidentally truncated
 * this file down to just `registerServerSentry()`, regressing items
 * 2-5 above. Restored here.
 */
import { registerServerSentry } from "@/lib/monitoring/sentry.server";
import { createLogger } from "@/lib/logging";

const logger = createLogger("instrumentation");

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 1) Sentry first so subsequent boot errors are captured.
  registerServerSentry();

  // 2) BigInt patch must load before any JSON serialization runs.
  await import("./lib/bigint-patch");

  // 3) TR-001 T13c — start all durable-job workers (idempotent).
  try {
    const { startWorkerLifecycle } = await import("./lib/workers/startup");
    await startWorkerLifecycle();
  } catch (err) {
    logger.error("Worker lifecycle startup failed", err);
  }

  // 4) TR-051 — admin password consistency check (env vs DB hash).
  //    Read-only + log-only; do not throw (avoid locking out production).
  try {
    const { verifyAdminPasswordConsistency } = await import("./lib/auth/bootstrap");
    const result = await verifyAdminPasswordConsistency();
    if (result.ok) {
      logger.info("Admin password consistency OK", { username: result.username });
    } else {
      logger.error("Admin password consistency check failed", { message: result.message });
    }
  } catch (err) {
    logger.error("Admin password consistency check errored", err);
  }

  // 5) TR-002 R4 — startup public-exposure probe for the direct gateway.
  //    fire-and-forget (setImmediate inside), 3s timeout, warning only.
  try {
    const { scheduleDirectGatewayExposureProbe } = await import("./lib/server/direct-gateway-probe");
    scheduleDirectGatewayExposureProbe();
  } catch (err) {
    logger.error("Direct gateway probe schedule failed", err);
  }
}
