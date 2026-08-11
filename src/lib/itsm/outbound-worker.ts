import { config } from "@/lib/config/env";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { fanOutTicketEvent } from "./service-outbound";

export const ITSM_OUTBOUND_JOB_TYPE = "itsm.outbound";
const INTERVAL_MS = 5_000;
const LEASE_MS = computeLeaseMs("itsm-outbound");
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:itsm-outbound:${process.pid}`;
const logger = createLogger("itsm-outbound-worker");

type State = { started: boolean; running: boolean; timer: NodeJS.Timeout | null };
type WorkerGlobal = typeof globalThis & { __vcontrolhubItsmOutboundWorker?: State };

function state(): State {
  const target = globalThis as WorkerGlobal;
  target.__vcontrolhubItsmOutboundWorker ??= { started: false, running: false, timer: null };
  return target.__vcontrolhubItsmOutboundWorker;
}

function parsePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid ITSM outbound job payload");
  const value = payload as Record<string, unknown>;
  const required = ["ticketId", "eventType", "title", "description", "status", "priority"] as const;
  for (const key of required) if (typeof value[key] !== "string" || !String(value[key]).trim()) throw new Error(`Invalid ITSM outbound payload field: ${key}`);
  return {
    ticketId: String(value.ticketId),
    eventType: String(value.eventType),
    title: String(value.title),
    description: String(value.description),
    status: String(value.status),
    priority: String(value.priority),
    category: typeof value.category === "string" ? value.category : null,
    commentBody: typeof value.commentBody === "string" ? value.commentBody : undefined,
    teamId: typeof value.teamId === "string" ? value.teamId : null,
  };
}

export async function runItsmOutboundWorkerOnce(): Promise<boolean> {
  const current = state();
  if (current.running) return false;
  current.running = true;
  try {
    const job = await claimNextJob({ workerId: WORKER_ID, types: [ITSM_OUTBOUND_JOB_TYPE], leaseMs: LEASE_MS });
    if (!job) return false;
    try {
      await heartbeatJob(job.id, WORKER_ID, {
        leaseMs: LEASE_MS,
        progress: "Delivering ITSM event",
      });
      const result = await runWithLeaseHeartbeat({
        jobId: job.id,
        leaseMs: LEASE_MS,
        heartbeat: () => heartbeatJob(job.id, WORKER_ID, {
          leaseMs: LEASE_MS,
          progress: "Delivering ITSM event",
        }),
        run: () => fanOutTicketEvent({ ...parsePayload(job.payload), deliveryKey: job.id }),
      });
      if (result.failed > 0) throw new Error(`${result.failed} ITSM connection(s) failed; ${result.sent} delivered`);
      await completeJob(job.id, WORKER_ID, result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, WORKER_ID, message.slice(0, 2000), { retryAfterMs: 30_000 });
      logger.warn("ITSM outbound job attempt failed", { jobId: job.id, error: message });
    }
    return true;
  } finally {
    current.running = false;
  }
}

export async function startItsmOutboundWorker() {
  const current = state();
  if (current.started) return current;
  current.started = true;
  void runItsmOutboundWorkerOnce().catch((error) => logger.error("ITSM outbound worker tick failed", { error: error instanceof Error ? error.message : String(error) }));
  current.timer = setInterval(() => {
    void runItsmOutboundWorkerOnce().catch((error) => logger.error("ITSM outbound worker tick failed", { error: error instanceof Error ? error.message : String(error) }));
  }, INTERVAL_MS);
  current.timer.unref?.();
  return current;
}

export function stopItsmOutboundWorkerForTests() {
  const current = state();
  if (current.timer) clearInterval(current.timer);
  current.started = false;
  current.running = false;
  current.timer = null;
}
