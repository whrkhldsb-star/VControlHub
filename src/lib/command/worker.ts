import { createLogger } from "@/lib/logging";
import { getRuntimeSettingNumber } from "@/lib/runtime-settings/service";
import { createSingletonIntervalWorker } from "@/lib/workers/singleton-interval-worker";

import {
  recoverQueuedApprovedCommandRequests,
  recoverStaleRunningCommandRequests,
} from "./service";

const logger = createLogger("command-maintenance-worker");

const commandMaintenanceWorker = createSingletonIntervalWorker({
  globalKey: "__vcontrolhubCommandMaintenanceWorker",
  resolveIntervalMs: () => getRuntimeSettingNumber("runtime.commandReconcileIntervalMs"),
  tick: (state, reason) => {
    void reconcileStaleCommandsOnce(state, reason);
  },
  onStarted: (_state, intervalMs) => {
    logger.info("Command maintenance worker started", { intervalMs });
  },
});

async function getCommandReconcileIntervalMs() {
  return getRuntimeSettingNumber("runtime.commandReconcileIntervalMs");
}

async function reconcileStaleCommandsOnce(
  state: ReturnType<typeof commandMaintenanceWorker.getState>,
  reason: string,
) {
  if (state.running) {
    logger.warn("Skipping command reconciliation because a previous tick is still running", { reason });
    return;
  }

  state.running = true;
  try {
    const queued = await recoverQueuedApprovedCommandRequests();
    if (queued.enqueued > 0) {
      logger.warn("Re-enqueued approved command requests", { reason, enqueued: queued.enqueued });
    }

    const result = await recoverStaleRunningCommandRequests();
    if (result.recovered > 0) {
      logger.warn("Recovered stale command requests", { reason, recovered: result.recovered });
    }
  } catch (error) {
    logger.error("Command reconciliation failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    state.running = false;
  }
}

export async function startCommandMaintenanceWorker() {
  // Resolve interval BEFORE starting so a settings/DB failure does not
  // permanently latch started=true with timer=null (no recovery forever).
  let intervalMs: number;
  try {
    intervalMs = await getCommandReconcileIntervalMs();
  } catch (error) {
    logger.error("Command maintenance worker failed to resolve interval; not started", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return (await commandMaintenanceWorker.start({ intervalMs })).state;
}

export function stopCommandMaintenanceWorkerForTests() {
  commandMaintenanceWorker.stopForTests();
}
