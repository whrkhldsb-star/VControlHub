/**
 * Worker startup orchestrator — single entry point called from
 * `src/instrumentation.ts` to start every durable-job worker.
 *
 * TR-001 T13c: the previous design had workers split between
 * `src/server.ts` (started all 8) and `src/instrumentation.ts`
 * (started only command workers, behind an env var). That meant a
 * future `next start` deployment (without the custom server) would
 * silently lose every non-command worker (download.execute,
 * scheduled-task.tick, etc.).
 *
 * This orchestrator centralizes startup behind one function call:
 *
 *     import { startWorkerLifecycle } from "@/lib/workers/startup";
 *     await startWorkerLifecycle();
 *
 * Behavior:
 *   - Skips startup in test mode (VITEST === "true" OR NODE_ENV === "test").
 *   - Honors the kill switch (VCONTROLHUB_WORKERS_DISABLED === "true").
 *   - Registers a SIGTERM/SIGINT handler for graceful shutdown, but
 *     only once per process (idempotent for hot-reload safety).
 *   - Logs start success/failure via `@/lib/logging` so the journal
 *     matches the rest of the service.
 *
 * Note: the function is intentionally idempotent at the registry
 * level — calling it twice will short-circuit and not double-start
 * any worker.
 */
import { startAllWorkers, stopAllWorkers, type WorkerId } from "@/lib/workers/registry";
import { createLogger } from "@/lib/logging";

const logger = createLogger("workers-lifecycle");

type LifecycleState = {
  installed: boolean;
  started: boolean;
  startedAt: string | null;
  startedWorkerIds: WorkerId[];
  failedWorkers: Array<{ id: WorkerId; error: string }>;
  shutdownHandlerInstalled: boolean;
};

type LifecycleGlobal = typeof globalThis & {
  __vcontrolhubWorkerLifecycle?: LifecycleState;
};

function getLifecycleState(): LifecycleState {
  const g = globalThis as LifecycleGlobal;
  if (!g.__vcontrolhubWorkerLifecycle) {
    g.__vcontrolhubWorkerLifecycle = {
      installed: false,
      started: false,
      startedAt: null,
      startedWorkerIds: [],
      failedWorkers: [],
      shutdownHandlerInstalled: false,
    };
  }
  return g.__vcontrolhubWorkerLifecycle;
}

/**
 * Should worker startup be skipped for this process?
 *
 * - VITEST=true — vitest's happy-dom/jsdom sets this. Workers would
 *   interfere with the test process and they don't have a real
 *   postgres connection anyway.
 * - NODE_ENV=test — alternate convention used by some test runners.
 * - VCONTROLHUB_WORKERS_DISABLED=true — manual kill switch for
 *   emergency "stop all background work" without code changes.
 */
function shouldSkipStartup(): boolean {
  if (process.env.VITEST === "true") return true;
  if (process.env.NODE_ENV === "test") return true;
  if (process.env.VCONTROLHUB_WORKERS_DISABLED === "true") return true;
  return false;
}

function installShutdownHandler(): void {
  const state = getLifecycleState();
  if (state.shutdownHandlerInstalled) return;
  state.shutdownHandlerInstalled = true;

  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("worker lifecycle shutdown signal received", { signal });
    try {
      stopAllWorkers();
    } catch (error) {
      logger.error("worker shutdown error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Do NOT call process.exit — the Next.js process owns lifecycle
    // decisions. We just clear the timers so a future SIGKILL has
    // nothing to wait for.
  };

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

/**
 * Start every worker. Idempotent — second call returns the same
 * snapshot without re-starting. Returns the lifecycle state for
 * the caller's logging / health-check consumption.
 */
export async function startWorkerLifecycle(): Promise<{
  started: WorkerId[];
  failed: Array<{ id: WorkerId; error: string }>;
  skipped: boolean;
  reason?: "test" | "disabled" | "already-started";
}> {
  const state = getLifecycleState();
  if (state.installed) {
    return {
      started: state.startedWorkerIds,
      failed: state.failedWorkers,
      skipped: true,
      reason: "already-started",
    };
  }
  state.installed = true;

  if (shouldSkipStartup()) {
    const reason: "test" | "disabled" = process.env.VCONTROLHUB_WORKERS_DISABLED === "true" ? "disabled" : "test";
    logger.info("worker startup skipped", { reason });
    return { started: [], failed: [], skipped: true, reason };
  }

  installShutdownHandler();

  const result = await startAllWorkers({
    logger: (msg, meta) => logger.info(msg, meta),
    // Most workers run an immediate DB-backed tick. A short stagger prevents
    // all 15 ticks from competing for Prisma transactions during process boot.
    betweenWorkerDelayMs: 200,
  });

  state.started = true;
  state.startedAt = new Date().toISOString();
  state.startedWorkerIds = result.started;
  state.failedWorkers = result.failed;

  logger.info("worker lifecycle started", {
    startedCount: result.started.length,
    failedCount: result.failed.length,
  });
  if (result.failed.length > 0) {
    logger.warn("some workers failed to start", { failed: result.failed });
  }

  return { ...result, skipped: false };
}

/**
 * Manually trigger a shutdown (e.g. from a test). In production
 * SIGTERM/SIGINT drives this automatically.
 */
export function stopWorkerLifecycle(): void {
  stopAllWorkers();
  const state = getLifecycleState();
  state.started = false;
  state.startedAt = null;
  state.startedWorkerIds = [];
  state.failedWorkers = [];
}

/**
 * Test-only: reset all lifecycle state. Production code never calls this.
 */
export function _resetWorkerLifecycleForTests(): void {
  const g = globalThis as LifecycleGlobal;
  delete g.__vcontrolhubWorkerLifecycle;
}
