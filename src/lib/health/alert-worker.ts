import { JobStatus } from "@prisma/client";

import { ensureDefaultAlertRules } from "@/lib/alert/service";
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, enqueueJob, failJob, heartbeatJob, pruneCompletedJobsByType } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

import { evaluateAlerts } from "./service";

const logger = createLogger("alert-evaluation-worker");

export const ALERT_EVALUATION_JOB_TYPE = "alert.evaluate";

const ALERT_EVALUATION_INTERVAL_MS = 60_000;
// TR-002 R2: 跨 worker lease 公式统一。computeLeaseMs 默认返 preset (= 60s, 等同原 ALERT_EVALUATION_LEASE_MS)。
const ALERT_EVALUATION_LEASE_MS = computeLeaseMs("alert-evaluation");
const ALERT_EVALUATION_RETENTION_KEEP_LATEST = 25;
const ALERT_EVALUATION_RETENTION_DAYS = 7;
const ALERT_EVALUATION_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:alert:${process.pid}`;

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

async function hasActiveEvaluationJob() {
  const existing = await prisma.job.findFirst({
    where: {
      type: ALERT_EVALUATION_JOB_TYPE,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function enqueueAlertEvaluationJob(reason: string) {
  if (await hasActiveEvaluationJob()) return null;
  return enqueueJob({
    type: ALERT_EVALUATION_JOB_TYPE,
    title: "Alert rule evaluation",
    payload: { reason, requestedAt: new Date().toISOString() },
    priority: -10,
    maxAttempts: 3,
  });
}

async function pruneCompletedAlertEvaluationJobs() {
  const olderThan = new Date(Date.now() - ALERT_EVALUATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  try {
    const result = await pruneCompletedJobsByType({
      type: ALERT_EVALUATION_JOB_TYPE,
      keepLatest: ALERT_EVALUATION_RETENTION_KEEP_LATEST,
      olderThan,
    });
    if (result.count > 0) {
      logger.info("Pruned completed alert evaluation jobs", { count: result.count, keepLatest: ALERT_EVALUATION_RETENTION_KEEP_LATEST, olderThan: olderThan.toISOString() });
    }
  } catch (error) {
    logger.warn("Failed to prune completed alert evaluation jobs", { error: error instanceof Error ? error.message : String(error) });
  }
}

async function processAlertEvaluation(jobId: string) {
  await heartbeatJob(jobId, ALERT_EVALUATION_WORKER_ID, {
    leaseMs: ALERT_EVALUATION_LEASE_MS,
    progress: "Ensuring default alert rules",
  });
  // Fresh installs previously left evaluation as a pure no-op until someone
  // opened /alert-rules. Bootstrap starter rules at worker time as well.
  try {
    await ensureDefaultAlertRules(null);
  } catch (error) {
    logger.warn("Failed to ensure default alert rules before evaluation", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  await heartbeatJob(jobId, ALERT_EVALUATION_WORKER_ID, {
    leaseMs: ALERT_EVALUATION_LEASE_MS,
    progress: "Evaluating alert rules",
  });
  return evaluateAlerts();
}

export async function runAlertEvaluationJobWorkerOnce(reason = "manual") {
  const state = getWorkerState();
  if (state.running) {
    logger.warn("Skipping alert evaluation tick because a previous tick is still running", { reason });
    return false;
  }

  state.running = true;
  try {
    await enqueueAlertEvaluationJob(reason);
    const job = await claimNextJob({ workerId: ALERT_EVALUATION_WORKER_ID, types: [ALERT_EVALUATION_JOB_TYPE], leaseMs: ALERT_EVALUATION_LEASE_MS });
    if (!job) return false;

    try {
      const result = await processAlertEvaluation(job.id);
      await completeJob(job.id, ALERT_EVALUATION_WORKER_ID, result ?? { evaluated: true });
      await pruneCompletedAlertEvaluationJobs();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Alert evaluation failed";
      await failJob(job.id, ALERT_EVALUATION_WORKER_ID, message.slice(0, 2000), { retryAfterMs: 60_000 });
      logger.error("Alert evaluation failed", { reason, jobId: job.id, error: message });
      return true;
    }
  } finally {
    state.running = false;
  }
}

export async function startAlertEvaluationWorker() {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = ALERT_EVALUATION_INTERVAL_MS;

  void runAlertEvaluationJobWorkerOnce("startup").catch((error) => {
    logger.error("Alert evaluation worker tick failed", { reason: "startup", error: error instanceof Error ? error.message : String(error) });
  });
  state.timer = setInterval(() => {
    void runAlertEvaluationJobWorkerOnce("interval").catch((error) => {
      logger.error("Alert evaluation worker tick failed", { reason: "interval", error: error instanceof Error ? error.message : String(error) });
    });
  }, intervalMs);
  state.timer.unref?.();

  logger.info("alert evaluation durable job worker started", { workerId: ALERT_EVALUATION_WORKER_ID, intervalMs });
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
