import { JobStatus } from "@prisma/client";

import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, enqueueJob, failJob, heartbeatJob, pruneCompletedJobsByType } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { createSingletonIntervalWorker } from "@/lib/workers/singleton-interval-worker";

import { escalateBreachedTickets } from "./sla";

const logger = createLogger("ticket-sla-worker");

export const TICKET_SLA_JOB_TYPE = "ticket.sla-escalate";
const TICKET_SLA_INTERVAL_MS = 60_000;
const TICKET_SLA_LEASE_MS = computeLeaseMs("ticket-sla");
const TICKET_SLA_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:ticket-sla:${process.pid}`;
const RETENTION_KEEP_LATEST = 25;

const ticketSlaWorker = createSingletonIntervalWorker({
  globalKey: "__vcontrolhubTicketSlaWorker",
  resolveIntervalMs: () => TICKET_SLA_INTERVAL_MS,
  tick: (_state, reason) => {
    void runTicketSlaJobWorkerOnce(reason).catch((error) => {
      logger.error("Ticket SLA worker tick failed", { reason, error: error instanceof Error ? error.message : String(error) });
    });
  },
  onStarted: () => {
    logger.info("ticket SLA durable job worker started", { workerId: TICKET_SLA_WORKER_ID, intervalMs: TICKET_SLA_INTERVAL_MS });
  },
});

async function hasActiveJob(): Promise<boolean> {
  const existing = await prisma.job.findFirst({
    where: { type: TICKET_SLA_JOB_TYPE, status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
    select: { id: true },
  });
  return Boolean(existing);
}

async function enqueueSweep(reason: string) {
  // Serialize multi-process ticks so findActive → enqueue is not TOCTOU.
  const release = await tryAcquireAdvisoryLock("ticket-sla-enqueue", "global");
  if (!release) {
    // Another worker is already deciding whether to enqueue; skip this tick's enqueue.
    return null;
  }
  try {
    if (await hasActiveJob()) return null;
    return await enqueueJob({
      type: TICKET_SLA_JOB_TYPE,
      title: "Ticket SLA escalation sweep",
      payload: { reason, requestedAt: new Date().toISOString() },
      priority: -10,
      maxAttempts: 3,
    });
  } finally {
    await release();
  }
}

async function pruneCompletedJobs() {
  try {
    await pruneCompletedJobsByType({
      type: TICKET_SLA_JOB_TYPE,
      keepLatest: RETENTION_KEEP_LATEST,
    });
  } catch (error) {
    logger.warn("Failed to prune completed ticket SLA jobs", { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function runTicketSlaJobWorkerOnce(reason = "manual") {
  const state = ticketSlaWorker.getState();
  if (state.running) {
    logger.warn("Skipping ticket SLA tick because a previous tick is still running", { reason });
    return false;
  }

  state.running = true;
  try {
    await enqueueSweep(reason);
    const job = await claimNextJob({ workerId: TICKET_SLA_WORKER_ID, types: [TICKET_SLA_JOB_TYPE], leaseMs: TICKET_SLA_LEASE_MS });
    if (!job) return false;

    try {
      await heartbeatJob(job.id, TICKET_SLA_WORKER_ID, {
        leaseMs: TICKET_SLA_LEASE_MS,
        progress: "Checking ticket SLA deadlines",
      });
      const escalated = await runWithLeaseHeartbeat({
        jobId: job.id,
        leaseMs: TICKET_SLA_LEASE_MS,
        heartbeat: () => heartbeatJob(job.id, TICKET_SLA_WORKER_ID, {
          leaseMs: TICKET_SLA_LEASE_MS,
          progress: "Checking ticket SLA deadlines",
        }),
        run: () => escalateBreachedTickets(),
      });
      await completeJob(job.id, TICKET_SLA_WORKER_ID, { escalated });
      await pruneCompletedJobs();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ticket SLA escalation failed";
      await failJob(job.id, TICKET_SLA_WORKER_ID, message.slice(0, 2000), { retryAfterMs: TICKET_SLA_INTERVAL_MS });
      logger.error("Ticket SLA escalation failed", { reason, jobId: job.id, error: message });
      return true;
    }
  } finally {
    state.running = false;
  }
}

export async function startTicketSlaWorker() {
  return (await ticketSlaWorker.start()).state;
}

export function stopTicketSlaWorkerForTests() {
  ticketSlaWorker.stopForTests();
}
