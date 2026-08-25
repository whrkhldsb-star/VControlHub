import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { closeSshPool } from "@/lib/ssh/client";
import { startWorkerLifecycle, stopWorkerLifecycle } from "@/lib/workers/startup";

const logger = createLogger("worker-process");

/**
 * systemd's default TimeoutStopSec is 90s. Pooled SSH sockets are ref'd
 * handles, so the event loop stays alive after the lifecycle teardown and
 * systemd escalates to SIGKILL on every stop/restart. Exit deliberately
 * instead, with a hard cap well below the systemd deadline.
 */
const SHUTDOWN_HARD_DEADLINE_MS = 10_000;

async function main() {
  const result = await startWorkerLifecycle();
  if (result.skipped) {
    throw new Error(`Worker process startup was skipped: ${result.reason ?? "unknown"}`);
  }
  if (result.failed.length > 0) {
    throw new Error(
      `Failed to start ${result.failed.length} worker(s): ${result.failed
        .map((failure) => failure.id)
        .join(", ")}`,
    );
  }
  logger.info("standalone worker process ready", { workerCount: result.started.length });

  // Keep the event loop alive even if the Prisma pool drops (all worker
  // timers are unref'd and a pending Promise does not anchor the loop).
  // Without this anchor the process could exit silently on a DB blip.
  const keepAlive = setInterval(() => undefined, 60_000);
  try {
    const signal = await new Promise<NodeJS.Signals>((resolve) => {
      process.once("SIGTERM", resolve);
      process.once("SIGINT", resolve);
    });
    logger.info("standalone worker process shutting down", { signal });
  } finally {
    clearInterval(keepAlive);
    // Never let a stuck teardown step turn a routine restart into SIGKILL.
    const forceExit = setTimeout(() => {
      logger.warn("worker shutdown exceeded hard deadline; exiting", {
        deadlineMs: SHUTDOWN_HARD_DEADLINE_MS,
      });
      process.exit(0);
    }, SHUTDOWN_HARD_DEADLINE_MS);
    forceExit.unref();
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
    logger.info("standalone worker process shutdown complete");
    process.exit(0);
  }
}

main().catch((error) => {
  logger.error("standalone worker process failed", error);
  process.exit(1);
});
