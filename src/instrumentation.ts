export async function register() {
  // Load BigInt serialization patch early
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./lib/bigint-patch");
    if (process.env.VCONTROLHUB_START_COMMAND_WORKER_IN_NEXT === "true") {
      const { startCommandMaintenanceWorker } = await import("./lib/command/worker");
      const { startCommandExecutionWorker } = await import("./lib/command/execution-worker");
      await startCommandMaintenanceWorker();
      await startCommandExecutionWorker();
    }
  }
}
