/**
 * Job maintenance — abandon stale PENDING jobs with no known consumer.
 *
 * Historical migrations / experimental job types (e.g. `playbook.command`)
 * can leave forever-PENDING rows that no worker claims. This keeps the
 * queue honest without reintroducing those dead types.
 */
import { JobStatus } from "@prisma/client";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

const logger = createLogger("job-maintenance-worker");

/**
 * Known durable job types with a consumer. Keep this list explicit — do NOT
 * import WORKER_REGISTRY here (registry imports this module; a cycle causes
 * TDZ failures when Next collects `/api/admin/workers` page data).
 */
const KNOWN_JOB_TYPES = new Set([
  "backup.create",
  "backup.restore",
  "backup.retention",
  "backup.drill",
  "backup-schedule.tick",
  "vps-backup.create",
  "vps-backup-schedule.tick",
  "command.execution",
  "command.maintenance",
  "download.execute",
  "playbook.run",
  "scheduled-task.tick",
  "health.sample",
  "alert.evaluate",
  "traffic.sample",
  "cost.snapshot",
  "ticket.sla",
  "ticket.sla-escalate",
  "ai-ops.scan",
  "ai.ops.scan",
  "quick-service.lifecycle",
  "storage.sftp-sync",
  "sftp.sync",
  "storage.sftp-stale-inventory",
  "sftp.stale-inventory",
  "sync.schedule.tick",
  "sync.schedule",
  "operation-task.retention",
  "job.maintenance",
]);

const DEFAULT_INTERVAL_MS = 15 * 60_000;
const STALE_PENDING_MS = 24 * 60 * 60 * 1000;
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:job-maintenance:${process.pid}`;

type State = { started: boolean; running: boolean; timer: NodeJS.Timeout | null };
type G = typeof globalThis & { __vcontrolhubJobMaintenanceWorker?: State };

function getState(): State {
  const g = globalThis as G;
  g.__vcontrolhubJobMaintenanceWorker ??= { started: false, running: false, timer: null };
  return g.__vcontrolhubJobMaintenanceWorker;
}

/**
 * Cancel PENDING jobs that are:
 *  - older than 24h, AND
 *  - of an unknown type (no registered consumer), OR
 *  - of a known type but never claimed and older than 7d (hard orphan).
 */
export async function abandonOrphanPendingJobs(options?: {
  olderThanMs?: number;
  hardOrphanMs?: number;
  limit?: number;
}) {
  const olderThanMs = options?.olderThanMs ?? STALE_PENDING_MS;
  const hardOrphanMs = options?.hardOrphanMs ?? 7 * 24 * 60 * 60 * 1000;
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const softCutoff = new Date(Date.now() - olderThanMs);
  const hardCutoff = new Date(Date.now() - hardOrphanMs);

  const candidates = await prisma.job.findMany({
    where: {
      status: JobStatus.PENDING,
      createdAt: { lt: softCutoff },
    },
    select: { id: true, type: true, createdAt: true, title: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const toCancel = candidates.filter((job) => {
    if (!KNOWN_JOB_TYPES.has(job.type)) return true;
    return job.createdAt < hardCutoff;
  });
  if (toCancel.length === 0) return { cancelled: 0, ids: [] as string[] };

  const ids: string[] = [];
  for (const job of toCancel) {
    const updated = await prisma.job.updateMany({
      where: { id: job.id, status: JobStatus.PENDING },
      data: {
        status: JobStatus.CANCELLED,
        cancelledAt: new Date(),
        errorMessage: KNOWN_JOB_TYPES.has(job.type)
          ? "Stale PENDING job abandoned after 7d without claim"
          : `Orphan job type cancelled (no consumer): ${job.type}`,
        workerId: null,
        workerHeartbeatAt: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count > 0) ids.push(job.id);
  }

  if (ids.length > 0) {
    logger.warn("abandoned orphan PENDING jobs", {
      workerId: WORKER_ID,
      cancelled: ids.length,
      ids,
      types: [...new Set(toCancel.map((j) => j.type))],
    });
  }
  return { cancelled: ids.length, ids };
}

async function tick(reason: string) {
  const state = getState();
  if (state.running) return;
  state.running = true;
  try {
    await abandonOrphanPendingJobs();
  } catch (error) {
    logger.error("job maintenance tick failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    state.running = false;
  }
}

export async function startJobMaintenanceWorker(options?: { intervalMs?: number }) {
  const state = getState();
  if (state.started) return state;
  state.started = true;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  void tick("startup");
  state.timer = setInterval(() => {
    void tick("interval");
  }, intervalMs);
  state.timer.unref?.();
  logger.info("job maintenance worker started", { workerId: WORKER_ID, intervalMs });
  return state;
}

export function stopJobMaintenanceWorkerForTests() {
  const state = getState();
  if (state.timer) clearInterval(state.timer);
  state.started = false;
  state.running = false;
  state.timer = null;
}

/** Test helper */
export function _knownJobTypesForTests() {
  return new Set(KNOWN_JOB_TYPES);
}
