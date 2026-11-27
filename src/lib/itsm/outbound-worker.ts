import { config } from "@/lib/config/env";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";

function isLeaseLostError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "LeaseLostError");
}
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { createSingletonIntervalWorker } from "@/lib/workers/singleton-interval-worker";
import { deliverQueuedEvent } from "./service-outbound";

import { adoptLegacyTicketJobs, ITSM_OUTBOUND_JOB_TYPE, readTicketSnapshot } from "./outbox";
export { ITSM_OUTBOUND_JOB_TYPE };
const INTERVAL_MS = 5_000;
const LEASE_MS = computeLeaseMs("itsm-outbound");
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:itsm-outbound:${process.pid}`;
const logger = createLogger("itsm-outbound-worker");

const itsmOutboundWorker = createSingletonIntervalWorker({
  globalKey: "__vcontrolhubItsmOutboundWorker",
  resolveIntervalMs: () => INTERVAL_MS,
  tick: () => {
    void runItsmOutboundWorkerOnce().catch((error) => logger.error("ITSM outbound worker tick failed", { error: error instanceof Error ? error.message : String(error) }));
  },
});

function state() {
  return itsmOutboundWorker.getState();
}

export async function runItsmOutboundWorkerOnce(): Promise<boolean> {
  const current = state();
  if (current.running) return false;
  current.running = true;
  try {
    const job = await claimNextJob({ workerId: WORKER_ID, types: [ITSM_OUTBOUND_JOB_TYPE], leaseMs: LEASE_MS });
    if (!job) return false;
    try {
      const lease = await heartbeatJob(job.id, WORKER_ID, {
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        leaseMs: LEASE_MS,
        progress: "Delivering ITSM event",
      });
      if (lease && lease.count === 0) return true;
      const result = await runWithLeaseHeartbeat({
        jobId: job.id,
        leaseMs: LEASE_MS,
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        heartbeat: () => heartbeatJob(job.id, WORKER_ID, {
          ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
          leaseMs: LEASE_MS,
          progress: "Delivering ITSM event",
        }),
        run: async (signal) => {
          signal?.throwIfAborted();
          const payload = job.payload;
          if (payload && typeof payload === "object" && !Array.isArray(payload) && typeof payload.eventId === "string") {
            return signal ? deliverQueuedEvent(payload.eventId, { signal }) : deliverQueuedEvent(payload.eventId);
          }
          const review = await adoptLegacyTicketJobs(readTicketSnapshot(payload).ticketId, job.id);
          if (review.length) throw new Error(`Platform ownership review required for ITSM receipts: ${review.join(", ")}`);
          return { sent: 0, failed: 0 };
        },
      });
      if (result.failed > 0) throw new Error(`${result.failed} ITSM connection(s) failed; ${result.sent} delivered`);
      await completeJob(job.id, WORKER_ID, result, ...(job.attempts !== undefined ? [job.attempts] : []));
    } catch (error) {
      if (isLeaseLostError(error)) return true;
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, WORKER_ID, message.slice(0, 2000), {
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        retryAfterMs: 30_000,
      });
      logger.warn("ITSM outbound job attempt failed", { jobId: job.id, error: message });
    }
    return true;
  } finally {
    current.running = false;
  }
}

export async function startItsmOutboundWorker() {
  return itsmOutboundWorker.start();
}

export function stopItsmOutboundWorkerForTests() {
  itsmOutboundWorker.stopForTests();
}
