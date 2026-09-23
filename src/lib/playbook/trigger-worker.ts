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
import { createSingletonIntervalWorker, type SingletonIntervalWorkerState } from "@/lib/workers/singleton-interval-worker";

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

type State = SingletonIntervalWorkerState;

const playbookTriggerWorker = createSingletonIntervalWorker({
  globalKey: "__vcontrolhubPlaybookTriggerWorker",
  resolveIntervalMs: () => INTERVAL_MS,
  tick: (_state, reason) => {
    void runPlaybookTriggerTickJobWorkerOnce(reason).catch((error) =>
      logger.error(
        reason === "startup" ? "Playbook trigger startup tick failed" : "Playbook trigger interval tick failed",
        error,
      ),
    );
  },
  onStarted: (_state, intervalMs) => {
    logger.info("Playbook trigger worker started", { workerId: WORKER_ID, intervalMs });
  },
});

function getState() {
  return playbookTriggerWorker.getState();
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
  return (await playbookTriggerWorker.start(options)).state;
}

export function stopPlaybookTriggerWorkerForTests(): void {
  playbookTriggerWorker.stopForTests();
}
