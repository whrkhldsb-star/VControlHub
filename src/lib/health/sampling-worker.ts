import { JobStatus } from "@prisma/client";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { claimNextJob, completeJob, enqueueJob, failJob, heartbeatJob } from "@/lib/job/service";
import { computeLeaseMs } from "@/lib/job/lease";
import { createLogger } from "@/lib/logging";
import { collectAllHealth } from "./service-collect";
import { pruneMetricSnapshots, snapshotHealthOverview } from "./service-metrics";

export const HEALTH_SAMPLING_JOB_TYPE = "health.sample";
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:health-sampling:${process.pid}`;
const LEASE_MS = computeLeaseMs("health-sampling");
const DEFAULT_INTERVAL_MS = 5 * 60_000;
const RETENTION_MS = 30 * 24 * 60 * 60_000;
const logger = createLogger("health-sampling-worker");

type State = { started: boolean; running: boolean; timer: NodeJS.Timeout | null };
type WorkerGlobal = typeof globalThis & { __vcontrolhubHealthSamplingWorker?: State };

function getState(): State {
  const globalState = globalThis as WorkerGlobal;
  globalState.__vcontrolhubHealthSamplingWorker ??= { started: false, running: false, timer: null };
  return globalState.__vcontrolhubHealthSamplingWorker;
}

export async function enqueueHealthSampleIfIdle(reason: string): Promise<boolean> {
  const active = await prisma.job.findFirst({
    where: { type: HEALTH_SAMPLING_JOB_TYPE, status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
    select: { id: true },
  });
  if (active) return false;
  await enqueueJob({ type: HEALTH_SAMPLING_JOB_TYPE, title: "Sample fleet health", payload: { reason }, maxAttempts: 3 });
  return true;
}

async function processSample(jobId: string) {
  await heartbeatJob(jobId, WORKER_ID, { leaseMs: LEASE_MS, progress: "Collecting fleet metrics" });
  const overview = await collectAllHealth();
  const sampled = await snapshotHealthOverview(overview);
  const pruned = await pruneMetricSnapshots(new Date(Date.now() - RETENTION_MS));
  return {
    sampled: sampled.count,
    online: overview.online,
    warning: overview.warning,
    critical: overview.critical,
    offline: overview.offline,
    pruned: pruned.count,
  };
}

export async function runHealthSamplingWorkerOnce(reason = "interval"): Promise<boolean> {
  const state = getState();
  if (state.running) return false;
  state.running = true;
  try {
    await enqueueHealthSampleIfIdle(reason);
    const job = await claimNextJob({ workerId: WORKER_ID, types: [HEALTH_SAMPLING_JOB_TYPE], leaseMs: LEASE_MS });
    if (!job) return false;
    try {
      const result = await processSample(job.id);
      await completeJob(job.id, WORKER_ID, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, WORKER_ID, message.slice(0, 2000), { retryAfterMs: 60_000 });
      logger.error("fleet health sample failed", { jobId: job.id, error: message });
    }
    return true;
  } finally {
    state.running = false;
  }
}

export async function startHealthSamplingWorker(options: { intervalMs?: number } = {}): Promise<State> {
  const state = getState();
  if (state.started) return state;
  state.started = true;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  void runHealthSamplingWorkerOnce("startup").catch((error) => logger.error("health sampling startup failed", error));
  state.timer = setInterval(() => {
    void runHealthSamplingWorkerOnce().catch((error) => logger.error("health sampling tick failed", error));
  }, intervalMs);
  state.timer.unref?.();
  logger.info("health sampling worker started", { workerId: WORKER_ID, intervalMs });
  return state;
}

export function stopHealthSamplingWorkerForTests(): void {
  const state = getState();
  if (state.timer) clearInterval(state.timer);
  state.started = false;
  state.running = false;
  state.timer = null;
}
