import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { startWorkerLifecycle, stopWorkerLifecycle } from "@/lib/workers/startup";

const logger = createLogger("worker-process");

async function main() {
  const result = await startWorkerLifecycle();
  if (result.skipped) {
    throw new Error(`Worker process startup was skipped: ${result.reason ?? "unknown"}`);
  }
  if (result.failed.length > 0) {
    throw new Error(`Failed to start ${result.failed.length} worker(s)`);
  }
  logger.info("standalone worker process ready", { workerCount: result.started.length });

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
