/**
 * Worker registry — single source of truth for all durable-job workers.
 *
 * TR-001 T13c: instead of starting each worker from `src/server.ts` (and
 * partially from `src/instrumentation.ts`), we describe every worker here
 * once, then a single orchestrator (`startup.ts`) starts/stops them all
 * from `src/instrumentation.ts`. `src/server.ts` no longer needs to call
 * `startXxxWorker()` directly.
 *
 * The orchestrator is responsible for:
 *   - skipping startup in test mode (VITEST=true / NODE_ENV=test)
 *   - honoring the kill switch (VCONTROLHUB_WORKERS_DISABLED=true)
 *   - registering a SIGTERM/SIGINT handler for graceful shutdown
 *
 * This file does NOT import any prisma/next/server code so it stays
 * importable from both the Next.js runtime and a future standalone
 * `src/worker.ts` entry point (potential systemd-unit split, deferred
 * to a follow-up TR per the README New-D note).
 */
import { startAlertEvaluationWorker, stopAlertEvaluationWorkerForTests } from "@/lib/health/alert-worker";
import { startHealthSamplingWorker, stopHealthSamplingWorkerForTests } from "@/lib/health/sampling-worker";
import { startAiOpsScanWorker, stopAiOpsScanWorkerForTests } from "@/lib/ai/ops/scan-worker";
import { startBackupJobWorker, stopBackupJobWorkerForTests } from "@/lib/backup/job-worker";
import { startBackupScheduleWorker, stopBackupScheduleWorkerForTests } from "@/lib/backup/schedule-worker";
import { startCommandExecutionWorker, stopCommandExecutionWorkerForTests } from "@/lib/command/execution-worker";
import { startCommandMaintenanceWorker, stopCommandMaintenanceWorkerForTests } from "@/lib/command/worker";
import { startDownloadJobWorker, stopDownloadJobWorkerForTests } from "@/lib/downloads/execution-worker";
import { startQuickServiceJobWorker, stopQuickServiceJobWorkerForTests } from "@/lib/quick-service/job-worker";
import { startScheduledTaskWorker, stopScheduledTaskWorkerForTests } from "@/lib/scheduled-task/worker";
import { startPlaybookRunWorker, stopPlaybookRunWorkerForTests } from "@/lib/playbook/worker";
import { startSftpSyncJobWorker, stopSftpSyncJobWorkerForTests } from "@/lib/storage/sftp-sync-job";
import { startSftpStaleInventoryWorker, stopSftpStaleInventoryWorkerForTests } from "@/lib/storage/sftp-stale-inventory-job";
import { startOperationTaskRetentionWorker, stopOperationTaskRetentionWorkerForTests } from "@/lib/operation-task/retention-worker";
import { startCostSnapshotWorker, stopCostSnapshotWorkerForTests } from "@/lib/cost/snapshot-worker";
import { startVpsBackupJobWorker, stopVpsBackupForTests } from "@/lib/backup/vps-backup-job-worker";
import { startVpsBackupScheduleWorker, stopVpsBackupScheduleForTests } from "@/lib/backup/vps-backup-schedule-worker";
import { startTicketSlaWorker, stopTicketSlaWorkerForTests } from "@/lib/ticket/sla-worker";

export type WorkerId =
  | "ai-ops-scan"
  | "alert-evaluation"
  | "backup"
  | "backup-schedule"
  | "command-execution"
  | "command-maintenance"
  | "cost-snapshot"
  | "download-execution"
  | "health-sampling"
  | "quick-service"
  | "scheduled-task"
  | "sftp-sync"
  | "sftp-stale-inventory"
  | "operation-task-retention"
  | "playbook-run"
  | "ticket-sla"
  | "vps-backup"
  | "vps-backup-schedule";

export type WorkerStatus = {
  id: WorkerId;
  label: string;
  jobType: string;
  /** True once `startXxxWorker()` has been called and the interval timer is set. */
  started: boolean;
};

type WorkerSpec = {
  id: WorkerId;
  label: string;
  jobType: string;
  start: () => Promise<unknown>;
  stop: () => void;
};

type WorkerRegistryGlobal = typeof globalThis & {
  __vcontrolhubWorkerRegistry?: Record<WorkerId, { started: boolean }>;
};

/**
 * Per-worker runtime flags. We mirror the underlying `started` state
 * into a small map on `globalThis` so the health check
 * (`/api/admin/workers`) can read it without re-importing every worker's
 * internal state type. The underlying workers remain the source of
 * truth — `start`/`stop` calls forward to them; this map is a
 * read-only cache populated by the orchestrator.
 */
function getRegistryState(): Record<WorkerId, { started: boolean }> {
  const g = globalThis as WorkerRegistryGlobal;
  if (!g.__vcontrolhubWorkerRegistry) {
    g.__vcontrolhubWorkerRegistry = {
      "ai-ops-scan": { started: false },
      "alert-evaluation": { started: false },
      backup: { started: false },
      "backup-schedule": { started: false },
      "command-execution": { started: false },
      "command-maintenance": { started: false },
      "cost-snapshot": { started: false },
      "download-execution": { started: false },
      "health-sampling": { started: false },
      "quick-service": { started: false },
      "scheduled-task": { started: false },
      "sftp-sync": { started: false },
      "sftp-stale-inventory": { started: false },
      "operation-task-retention": { started: false },
      "playbook-run": { started: false },
      "ticket-sla": { started: false },
      "vps-backup": { started: false },
      "vps-backup-schedule": { started: false },
    };
  }
  return g.__vcontrolhubWorkerRegistry;
}

function markStarted(id: WorkerId, started: boolean): void {
  const entry = getRegistryState()[id];
  if (entry) entry.started = started;
}

const ALERT_EVALUATION: WorkerSpec = {
  id: "alert-evaluation",
  label: "Alert rule evaluation",
  jobType: "alert.evaluate",
  start: async () => {
    await startAlertEvaluationWorker();
  },
  stop: () => stopAlertEvaluationWorkerForTests(),
};

const BACKUP: WorkerSpec = {
  id: "backup",
  label: "Backup task",
  jobType: "backup.create / backup.restore / backup.retention",
  start: () => {
    startBackupJobWorker();
    return Promise.resolve();
  },
  stop: () => stopBackupJobWorkerForTests(),
};

const BACKUP_SCHEDULE: WorkerSpec = {
  id: "backup-schedule",
  // TR-038: 60s tick — finds due BackupSchedule rows, creates PENDING
  // BackupRecord + enqueues backup.create durable job (picked up by the
  // `backup` worker above). Separated from `backup` so schedule dispatch
  // (lightweight DB writes) doesn't block on backup execution (heavy bash).
  label: "Backup schedule dispatch",
  jobType: "backup-schedule.tick",
  start: async () => {
    await startBackupScheduleWorker();
  },
  stop: () => stopBackupScheduleWorkerForTests(),
};

const COMMAND_EXECUTION: WorkerSpec = {
  id: "command-execution",
  label: "Command execution",
  jobType: "command.execution",
  start: async () => {
    await startCommandExecutionWorker();
  },
  stop: () => stopCommandExecutionWorkerForTests(),
};

const COMMAND_MAINTENANCE: WorkerSpec = {
  id: "command-maintenance",
  label: "Command maintenance",
  jobType: "command.maintenance",
  start: async () => {
    await startCommandMaintenanceWorker();
  },
  stop: () => stopCommandMaintenanceWorkerForTests(),
};

const HEALTH_SAMPLING: WorkerSpec = {
  id: "health-sampling",
  label: "Fleet health background sampling",
  jobType: "health.sample",
  start: async () => {
    await startHealthSamplingWorker();
  },
  stop: () => stopHealthSamplingWorkerForTests(),
};

const DOWNLOAD_EXECUTION: WorkerSpec = {
  id: "download-execution",
  label: "Download execution",
  jobType: "download.execute",
  start: async () => {
    await startDownloadJobWorker();
  },
  stop: () => stopDownloadJobWorkerForTests(),
};

const QUICK_SERVICE: WorkerSpec = {
  id: "quick-service",
  label: "Quick service lifecycle",
  jobType: "quick-service.lifecycle",
  start: async () => {
    await startQuickServiceJobWorker();
  },
  stop: () => stopQuickServiceJobWorkerForTests(),
};

const PLAYBOOK_RUN: WorkerSpec = {
  id: "playbook-run",
  label: "Durable playbook chain execution",
  jobType: "playbook.run",
  start: async () => {
    await startPlaybookRunWorker();
  },
  stop: () => stopPlaybookRunWorkerForTests(),
};

const SCHEDULED_TASK: WorkerSpec = {
  id: "scheduled-task",
  label: "Scheduled task dispatch",
  jobType: "scheduled-task.tick",
  start: async () => {
    await startScheduledTaskWorker();
  },
  stop: () => stopScheduledTaskWorkerForTests(),
};

const SFTP_SYNC: WorkerSpec = {
  id: "sftp-sync",
  label: "SFTP sync",
  jobType: "storage.sftp-sync",
  start: async () => {
    await startSftpSyncJobWorker();
  },
  stop: () => stopSftpSyncJobWorkerForTests(),
};

const SFTP_STALE_INVENTORY: WorkerSpec = {
  id: "sftp-stale-inventory",
  label: "SFTP remote inventory periodic verification",
  jobType: "storage.sftp-stale-inventory",
  start: async () => {
    await startSftpStaleInventoryWorker();
  },
  stop: () => stopSftpStaleInventoryWorkerForTests(),
};

const OPERATION_TASK_RETENTION: WorkerSpec = {
  id: "operation-task-retention",
  // TR-006: 跨来源统一长期保留策略, 6h tick, 跨 command/download/sync/backup/deployment 5 来源裁剪历史
  label: "Operation task cross-source retention policy",
  jobType: "operation-task.retention",
  start: async () => {
    await startOperationTaskRetentionWorker();
  },
  stop: () => stopOperationTaskRetentionWorkerForTests(),
};

const COST_SNAPSHOT: WorkerSpec = {
  id: "cost-snapshot",
  // TR-031 E01: 每日 01:00 跑 cost_entries → cost_snapshots 聚合
  label: "Cost daily aggregation snapshot",
  jobType: "cost.snapshot",
  start: () => {
    startCostSnapshotWorker();
    return Promise.resolve();
  },
  stop: () => stopCostSnapshotWorkerForTests(),
};

const AI_OPS_SCAN: WorkerSpec = {
  id: "ai-ops-scan",
  // TR-032 E02: 每日 02:00 跑 ai_ops_logs → 系统健康信号 surface
  label: "AI ops daily scan",
  jobType: "ai.ops.scan",
  start: () => {
    startAiOpsScanWorker();
    return Promise.resolve();
  },
  stop: () => stopAiOpsScanWorkerForTests(),
};

const TICKET_SLA: WorkerSpec = {
  id: "ticket-sla",
  label: "Ticket SLA escalation",
  jobType: "ticket.sla-escalate",
  start: async () => {
    await startTicketSlaWorker();
  },
  stop: () => stopTicketSlaWorkerForTests(),
};

const VPS_BACKUP: WorkerSpec = {
  id: "vps-backup",
  // TR-043: SSH exec → SFTP download → checksum → offsite upload
  label: "VPS remote backup",
  jobType: "vps-backup.create",
  start: () => {
    startVpsBackupJobWorker();
    return Promise.resolve();
  },
  stop: () => stopVpsBackupForTests(),
};

const VPS_BACKUP_SCHEDULE: WorkerSpec = {
  id: "vps-backup-schedule",
  // TR-043: 60s tick — finds due VpsBackupSchedule rows, creates PENDING
  // VpsBackupRecord + enqueues vps-backup.create durable job
  label: "VPS remote backup schedule dispatch",
  jobType: "vps-backup-schedule.tick",
  start: () => {
    startVpsBackupScheduleWorker();
    return Promise.resolve();
  },
  stop: () => stopVpsBackupScheduleForTests(),
};

export const WORKER_REGISTRY: readonly WorkerSpec[] = Object.freeze([
  AI_OPS_SCAN,
  ALERT_EVALUATION,
  BACKUP,
  BACKUP_SCHEDULE,
  COMMAND_EXECUTION,
  COMMAND_MAINTENANCE,
  COST_SNAPSHOT,
  HEALTH_SAMPLING,
  DOWNLOAD_EXECUTION,
  QUICK_SERVICE,
  SCHEDULED_TASK,
  SFTP_SYNC,
  SFTP_STALE_INVENTORY,
  OPERATION_TASK_RETENTION,
  PLAYBOOK_RUN,
  TICKET_SLA,
  VPS_BACKUP,
  VPS_BACKUP_SCHEDULE,
]);

/**
 * Start a single worker by id. Idempotent — the underlying
 * `startXxxWorker()` functions short-circuit if `state.started` is
 * true; we keep the registry flag in sync so the health check is
 * consistent across requests.
 */
export async function startWorker(id: WorkerId): Promise<void> {
  const spec = WORKER_REGISTRY.find((w) => w.id === id);
  if (!spec) throw new Error(`Unknown worker: ${id}`);
  if (getRegistryState()[id].started) return;
  await spec.start();
  markStarted(id, true);
}

/**
 * Stop a single worker by id. Calls the worker's
 * `stopXxxForTests()` which clears the interval timer and resets
 * `state.started = false` (this is correct for graceful shutdown:
 * the process is exiting, we don't want a phantom timer).
 */
export function stopWorker(id: WorkerId): void {
  const spec = WORKER_REGISTRY.find((w) => w.id === id);
  if (!spec) throw new Error(`Unknown worker: ${id}`);
  spec.stop();
  markStarted(id, false);
}

/**
 * Start every worker in the registry. Failures are isolated: if one
 * worker throws we log and continue, so a transient failure in (e.g.)
 * backup-create doesn't prevent alert-evaluation from starting.
 */
export async function startAllWorkers(options: {
  logger?: (msg: string, meta?: Record<string, unknown>) => void;
  /** Stagger immediate first ticks so DB-backed workers do not exhaust the transaction pool at boot. */
  betweenWorkerDelayMs?: number;
} = {}): Promise<{ started: WorkerId[]; failed: Array<{ id: WorkerId; error: string }> }> {
  const log = options.logger ?? (() => {});
  const betweenWorkerDelayMs = Math.max(0, options.betweenWorkerDelayMs ?? 0);
  const started: WorkerId[] = [];
  const failed: Array<{ id: WorkerId; error: string }> = [];
  for (const spec of WORKER_REGISTRY) {
    try {
      await startWorker(spec.id);
      started.push(spec.id);
      log("worker started", { id: spec.id, jobType: spec.jobType });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failed.push({ id: spec.id, error: message });
      log("worker start failed", { id: spec.id, jobType: spec.jobType, error: message });
    }
    if (betweenWorkerDelayMs > 0 && spec !== WORKER_REGISTRY.at(-1)) {
      await new Promise((resolve) => setTimeout(resolve, betweenWorkerDelayMs));
    }
  }
  return { started, failed };
}

/**
 * Stop every worker in the registry. Used by the SIGTERM handler in
 * `startup.ts` for graceful shutdown.
 */
export function stopAllWorkers(): void {
  for (const spec of WORKER_REGISTRY) {
    try {
      stopWorker(spec.id);
    } catch {
      // ignore — we're tearing down
    }
  }
}

/**
 * Read-only snapshot of every worker's status. Used by
 * `/api/admin/workers` health check. The `started` field reflects
 * whether the worker's `startXxxWorker()` call has succeeded and
 * the interval timer is set.
 */
export function getWorkerStatuses(): WorkerStatus[] {
  const state = getRegistryState();
  return WORKER_REGISTRY.map((spec) => ({
    id: spec.id,
    label: spec.label,
    jobType: spec.jobType,
    started: state[spec.id]?.started ?? false,
  }));
}

/** Test-only: reset the registry. Production code never calls this. */
export function _resetWorkerRegistryForTests(): void {
  for (const spec of WORKER_REGISTRY) {
    markStarted(spec.id, false);
  }
}
