import { JobStatus } from "@prisma/client";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, enqueueJob, failJob, heartbeatJob, pruneCompletedJobsByType } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

import { escalateBreachedTickets } from "./sla";

const logger = createLogger("ticket-sla-worker");

export const TICKET_SLA_JOB_TYPE = "ticket.sla-escalate";
const TICKET_SLA_INTERVAL_MS = 60_000;
const TICKET_SLA_LEASE_MS = computeLeaseMs("ticket-sla");
const TICKET_SLA_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:ticket-sla:${process.pid}`;
const RETENTION_KEEP_LATEST = 25;
const RETENTION_DAYS = 7;

type WorkerState = { started: boolean; running: boolean; timer: NodeJS.Timeout | null };
type WorkerGlobal = typeof globalThis & { __vcontrolhubTicketSlaWorker?: WorkerState };

function getWorkerState(): WorkerState {
  const globalState = globalThis as WorkerGlobal;
  globalState.__vcontrolhubTicketSlaWorker ??= { started: false, running: false, timer: null };
  return globalState.__vcontrolhubTicketSlaWorker;
}

async function hasActiveJob(): Promise<boolean> {
  const existing = await prisma.job.findFirst({
    where: { type: TICKET_SLA_JOB_TYPE, status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
    select: { id: true },
  });
  return Boolean(existing);
}

async function enqueueSweep(reason: string) {
  if (await hasActiveJob()) return null;
  return enqueueJob({
    type: TICKET_SLA_JOB_TYPE,
    title: "Ticket SLA escalation sweep",
    payload: { reason, requestedAt: new Date().toISOString() },
    priority: -10,
    maxAttempts: 3,
  });
}

async function pruneCompletedJobs() {
  try {
    await pruneCompletedJobsByType({
      type: TICKET_SLA_JOB_TYPE,
      keepLatest: RETENTION_KEEP_LATEST,
      olderThan: new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000),
    });
  } catch (error) {
    logger.warn("Failed to prune completed ticket SLA jobs", { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function runTicketSlaJobWorkerOnce(reason = "manual") {
  const state = getWorkerState();
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
      await heartbeatJob(job.id, TICKET_SLA_WORKER_ID, { leaseMs: TICKET_SLA_LEASE_MS, progress: "Checking ticket SLA deadlines" });
      const escalated = await escalateBreachedTickets();
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
  const state = getWorkerState();
  if (state.started) return state;
  state.started = true;

  void runTicketSlaJobWorkerOnce("startup").catch((error) => {
    logger.error("Ticket SLA worker tick failed", { reason: "startup", error: error instanceof Error ? error.message : String(error) });
  });
  state.timer = setInterval(() => {
    void runTicketSlaJobWorkerOnce("interval").catch((error) => {
      logger.error("Ticket SLA worker tick failed", { reason: "interval", error: error instanceof Error ? error.message : String(error) });
    });
  }, TICKET_SLA_INTERVAL_MS);
  state.timer.unref?.();

  logger.info("ticket SLA durable job worker started", { workerId: TICKET_SLA_WORKER_ID, intervalMs: TICKET_SLA_INTERVAL_MS });
  return state;
}

export function stopTicketSlaWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) clearInterval(state.timer);
  state.started = false;
  state.running = false;
  state.timer = null;
}
