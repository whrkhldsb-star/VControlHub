// First: the service code this process shares with the web server hands rows
// with BigInt columns to JSON.stringify, which throws without this patch.
import "@/lib/bigint-patch";

import { prisma } from "@/lib/db";
import { startBackgroundCopyLocaleSync } from "@/lib/i18n/background-locale";
import { createLogger } from "@/lib/logging";
import { primeSettingCaches } from "@/lib/settings/prime";
import { closeSshPool } from "@/lib/ssh/client";
import { startWorkerLifecycle, stopWorkerLifecycle } from "@/lib/workers/startup";

const logger = createLogger("worker-process");

// As in the web server and the SSH proxy: a stray rejection is logged, not
// allowed to end the process (Node's default) and every job running in it.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection:", reason);
});

/**
 * systemd's default TimeoutStopSec is 90s. Pooled SSH sockets are ref'd
 * handles, so the event loop stays alive after the lifecycle teardown and
 * systemd escalates to SIGKILL on every stop/restart. Exit deliberately
 * instead, with a hard cap well below the systemd deadline.
 */
const SHUTDOWN_HARD_DEADLINE_MS = 10_000;

async function main() {
  const shutdown = new AbortController();
  let forceExit: NodeJS.Timeout | undefined;
  const stopped = new Promise<void>(resolve => {
    const stop = (signal: NodeJS.Signals) => {
      if (shutdown.signal.aborted) return;
      shutdown.abort();
      logger.info("standalone worker process shutting down", { signal });
      forceExit = setTimeout(() => process.exit(0), SHUTDOWN_HARD_DEADLINE_MS);
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
  const keepAlive = setInterval(() => undefined, 60_000);
  let stopLocaleSync: (() => void) | undefined;
  try {
    await primeSettingCaches();
    if (shutdown.signal.aborted) return;
    stopLocaleSync = await startBackgroundCopyLocaleSync();
    if (shutdown.signal.aborted) return;
    const result = await startWorkerLifecycle(shutdown.signal);
    if (shutdown.signal.aborted) return;
    if (result.skipped || result.failed.length) throw new Error(`Worker startup incomplete: ${result.reason ?? result.failed.map(f => f.id).join(", ")}`);
    logger.info("standalone worker process ready", { workerCount: result.started.length });
    await stopped;
  } finally {
    clearInterval(keepAlive);
    stopLocaleSync?.();
    await stopWorkerLifecycle().catch((error: unknown) => {
      logger.error("worker lifecycle teardown failed", error);
    });
    // Pooled SSH connections are ref'd sockets that outlive the workers and
    // would otherwise keep the event loop (and the systemd stop job) alive.
    await closeSshPool().catch((error: unknown) => {
      logger.error("SSH pool teardown failed", error);
    });
    await prisma.$disconnect().catch((error: unknown) => {
      logger.error("prisma disconnect failed", error);
    });
    clearTimeout(forceExit);
    if (shutdown.signal.aborted) {
      logger.info("standalone worker process shutdown complete");
      process.exit(0);
    }
  }
}

main().catch((error) => {
  logger.error("standalone worker process failed", error);
  process.exit(1);
});
