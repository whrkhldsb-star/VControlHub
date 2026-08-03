import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { startWorkerLifecycle, stopWorkerLifecycle } from "@/lib/workers/startup";

const logger = createLogger("worker-process");

async function main() {
  const result = await startWorkerLifecycle();
  if (result.skipped) {
    throw new Error(`Worker process startup was skipped: ${result.reason ?? "unknown"}`);
  }
  if (result.started.length === 0 && result.failed.length > 0) {
    throw new Error(`Failed to start all ${result.failed.length} worker(s)`);
  }
  if (result.failed.length > 0) {
    // Registry-level isolation: one worker's transient startup failure must
    // not take the healthy workers down with it (see startAllWorkers).
    logger.warn("some workers failed to start; continuing with the rest", {
      failed: result.failed.map((failure) => failure.id),
    });
  }
  logger.info("standalone worker process ready", { workerCount: result.started.length });

  // Keep the event loop alive even if the Prisma pool drops (all worker
  // timers are unref'd and a pending Promise does not anchor the loop).
  // Without this anchor the process could exit silently on a DB blip.
  setInterval(() => undefined, 60_000);

  await new Promise<void>((resolve) => {
    process.once("SIGTERM", resolve);
    process.once("SIGINT", resolve);
  });
  await stopWorkerLifecycle();
  await prisma.$disconnect();
}

main().catch((error) => {
  logger.error("standalone worker process failed", error);
  process.exit(1);
});
