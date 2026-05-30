import { createLogger } from "@/lib/logging";

import {
  recoverQueuedApprovedCommandRequests,
  recoverStaleRunningCommandRequests,
} from "./service";

const logger = createLogger("command-maintenance-worker");
const DEFAULT_COMMAND_RECONCILE_INTERVAL_MS = 60_000;

type CommandMaintenanceWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type CommandMaintenanceWorkerGlobal = typeof globalThis & {
  __vcontrolhubCommandMaintenanceWorker?: CommandMaintenanceWorkerState;
};

function getWorkerState() {
  const globalState = globalThis as CommandMaintenanceWorkerGlobal;
  globalState.__vcontrolhubCommandMaintenanceWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubCommandMaintenanceWorker;
}

function getPositiveEnvNumber(name: string, fallback: number) {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function getCommandReconcileIntervalMs() {
  return getPositiveEnvNumber("COMMAND_RECONCILE_INTERVAL_MS", DEFAULT_COMMAND_RECONCILE_INTERVAL_MS);
}

async function reconcileStaleCommandsOnce(state: CommandMaintenanceWorkerState, reason: string) {
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

export function startCommandMaintenanceWorker() {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = getCommandReconcileIntervalMs();

  void reconcileStaleCommandsOnce(state, "startup");
  state.timer = setInterval(() => {
    void reconcileStaleCommandsOnce(state, "interval");
  }, intervalMs);
  state.timer.unref?.();

  logger.info("Command maintenance worker started", { intervalMs });
  return state;
}

export function stopCommandMaintenanceWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.started = false;
  state.running = false;
  state.timer = null;
}
