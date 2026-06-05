import { createLogger } from "@/lib/logging";

import { evaluateAlerts } from "./service";

const logger = createLogger("alert-evaluation-worker");

const ALERT_EVALUATION_INTERVAL_MS = 60_000;

type AlertEvaluationWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type AlertEvaluationWorkerGlobal = typeof globalThis & {
  __vcontrolhubAlertEvaluationWorker?: AlertEvaluationWorkerState;
};

function getWorkerState() {
  const globalState = globalThis as AlertEvaluationWorkerGlobal;
  globalState.__vcontrolhubAlertEvaluationWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubAlertEvaluationWorker;
}

async function evaluateAlertsOnce(state: AlertEvaluationWorkerState, reason: string) {
  if (state.running) {
    logger.warn("Skipping alert evaluation tick because a previous tick is still running", { reason });
    return;
  }

  state.running = true;
  try {
    await evaluateAlerts();
  } catch (error) {
    logger.error("Alert evaluation failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    state.running = false;
  }
}

export async function startAlertEvaluationWorker() {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = ALERT_EVALUATION_INTERVAL_MS;

  void evaluateAlertsOnce(state, "startup");
  state.timer = setInterval(() => {
    void evaluateAlertsOnce(state, "interval");
  }, intervalMs);
  state.timer.unref?.();

  logger.info("Alert evaluation worker started", { intervalMs });
  return state;
}

export function stopAlertEvaluationWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.started = false;
  state.running = false;
  state.timer = null;
}
