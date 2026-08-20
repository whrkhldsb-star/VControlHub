/**
 * Durable Cron-trigger dispatcher for Playbooks.
 *
 * The executor worker consumes `playbook.run`; this worker only turns due
 * Cron occurrences into those durable runs. Metric edges are dispatched by
 * the health sampling worker immediately after a fresh fleet sample.
 */
import { JobStatus } from "@prisma/client";

import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
import { computeLeaseMs } from "@/lib/job/lease";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
  pruneCompletedJobsByType,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

import {
  dispatchDueCronPlaybooks,
  initializeUnscheduledCronPlaybooks,
} from "./trigger-service";

export const PLAYBOOK_TRIGGER_TICK_JOB_TYPE = "playbook.trigger.tick";

const INTERVAL_MS = 60_000;
const LEASE_MS = computeLeaseMs("playbook-trigger");
const KEEP_LATEST = 50;
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:playbook-trigger:${process.pid}`;
const logger = createLogger("playbook-trigger-worker");

type State = { started: boolean; running: boolean; timer: NodeJS.Timeout | null };
type WorkerGlobal = typeof globalThis & { __vcontrolhubPlaybookTriggerWorker?: State };

function getState(): State {
  const globalState = globalThis as WorkerGlobal;
  globalState.__vcontrolhubPlaybookTriggerWorker ??= { started: false, running: false, timer: null };
  return globalState.__vcontrolhubPlaybookTriggerWorker;
}

async function enqueueTickIfIdle(reason: string) {
  const release = await tryAcquireAdvisoryLock("playbook-trigger-enqueue", "global");
  if (!release) return null;
  try {
    const active = await prisma.job.findFirst({
      where: {
        type: PLAYBOOK_TRIGGER_TICK_JOB_TYPE,
        status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (active) return null;
    return enqueueJob({
      type: PLAYBOOK_TRIGGER_TICK_JOB_TYPE,
      title: "Playbook Cron trigger dispatch tick",
      payload: { reason, requestedAt: new Date().toISOString() },
      priority: -5,
      maxAttempts: 3,
    });
  } finally {
    await release();
  }
}

export async function runPlaybookTriggerTickJobWorkerOnce(reason = "manual"): Promise<boolean> {
  const state = getState();
  if (state.running) return false;
  state.running = true;
  try {
    await enqueueTickIfIdle(reason);
    const job = await claimNextJob({
      workerId: WORKER_ID,
      types: [PLAYBOOK_TRIGGER_TICK_JOB_TYPE],
      leaseMs: LEASE_MS,
    });
    if (!job) return false;
    try {
      await heartbeatJob(job.id, WORKER_ID, {
        leaseMs: LEASE_MS,
        progress: "Dispatching due Playbook Cron triggers",
      });
      const result = await runWithLeaseHeartbeat({
        jobId: job.id,
        leaseMs: LEASE_MS,
        heartbeat: () => heartbeatJob(job.id, WORKER_ID, {
          leaseMs: LEASE_MS,
          progress: "Dispatching due Playbook Cron triggers",
        }),
        run: async () => {
          const now = new Date();
          const initialized = await initializeUnscheduledCronPlaybooks(now);
          const due = await dispatchDueCronPlaybooks(now);
          return { initialized, ...due };
        },
      });
      await completeJob(job.id, WORKER_ID, result);
      try {
        await pruneCompletedJobsByType({
          type: PLAYBOOK_TRIGGER_TICK_JOB_TYPE,
          keepLatest: KEEP_LATEST,
        });
      } catch (error) {
        logger.warn("Failed to prune playbook.trigger.tick jobs", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, WORKER_ID, message.slice(0, 2000), { retryAfterMs: INTERVAL_MS });
      logger.error("Playbook trigger tick job failed", { reason, jobId: job.id, error: message });
      return true;
    }
  } catch (error) {
    logger.error("Playbook trigger tick failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    state.running = false;
  }
}

export async function startPlaybookTriggerWorker(
  options: { intervalMs?: number } = {},
): Promise<State> {
  const state = getState();
  if (state.started) return state;
  state.started = true;
  const intervalMs = options.intervalMs ?? INTERVAL_MS;
  void runPlaybookTriggerTickJobWorkerOnce("startup").catch((error) =>
    logger.error("Playbook trigger startup tick failed", error),
  );
  state.timer = setInterval(() => {
    void runPlaybookTriggerTickJobWorkerOnce("interval").catch((error) =>
      logger.error("Playbook trigger interval tick failed", error),
    );
  }, intervalMs);
  state.timer.unref?.();
  logger.info("Playbook trigger worker started", { workerId: WORKER_ID, intervalMs });
  return state;
}

export function stopPlaybookTriggerWorkerForTests(): void {
  const state = getState();
  if (state.timer) clearInterval(state.timer);
  state.started = false;
  state.running = false;
  state.timer = null;
}
