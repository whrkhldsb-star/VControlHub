import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TR-001 T13c: registry is the single source of truth for which workers
 * exist. These tests verify the surface contract (start/stop/status)
 * without spinning up real prisma / next — the per-worker
 * `startXxxWorker()` functions are mocked in beforeEach so we can
 * assert registry bookkeeping in isolation.
 */
const {
  startAiOpsScanWorkerMock,
  stopAiOpsScanWorkerForTestsMock,
  startAlertEvaluationWorkerMock,
  stopAlertEvaluationWorkerForTestsMock,
  startBackupJobWorkerMock,
  stopBackupJobWorkerForTestsMock,
  startBackupScheduleWorkerMock,
  stopBackupScheduleWorkerForTestsMock,
  startCommandExecutionWorkerMock,
  stopCommandExecutionWorkerForTestsMock,
  startCommandMaintenanceWorkerMock,
  stopCommandMaintenanceWorkerForTestsMock,
  startDownloadJobWorkerMock,
  stopDownloadJobWorkerForTestsMock,
  startHealthSamplingWorkerMock,
  stopHealthSamplingWorkerForTestsMock,
  startQuickServiceJobWorkerMock,
  stopQuickServiceJobWorkerForTestsMock,
  startScheduledTaskWorkerMock,
  stopScheduledTaskWorkerForTestsMock,
  startPlaybookRunWorkerMock,
  stopPlaybookRunWorkerForTestsMock,
  startSftpSyncJobWorkerMock,
  stopSftpSyncJobWorkerForTestsMock,
  startSftpStaleInventoryWorkerMock,
  stopSftpStaleInventoryWorkerForTestsMock,
  startVpsBackupJobWorkerMock,
  stopVpsBackupForTestsMock,
  startVpsBackupScheduleWorkerMock,
  stopVpsBackupScheduleForTestsMock,
  startTicketSlaWorkerMock,
  stopTicketSlaWorkerForTestsMock,
} = vi.hoisted(() => ({
  startAiOpsScanWorkerMock: vi.fn(() => undefined),
  stopAiOpsScanWorkerForTestsMock: vi.fn(),
  startAlertEvaluationWorkerMock: vi.fn(async () => undefined),
  stopAlertEvaluationWorkerForTestsMock: vi.fn(),
  startBackupJobWorkerMock: vi.fn(() => undefined),
  stopBackupJobWorkerForTestsMock: vi.fn(),
  startBackupScheduleWorkerMock: vi.fn(async () => undefined),
  stopBackupScheduleWorkerForTestsMock: vi.fn(),
  startCommandExecutionWorkerMock: vi.fn(async () => undefined),
  stopCommandExecutionWorkerForTestsMock: vi.fn(),
  startCommandMaintenanceWorkerMock: vi.fn(async () => undefined),
  stopCommandMaintenanceWorkerForTestsMock: vi.fn(),
  startDownloadJobWorkerMock: vi.fn(async () => undefined),
  stopDownloadJobWorkerForTestsMock: vi.fn(),
  startHealthSamplingWorkerMock: vi.fn(async () => undefined),
  stopHealthSamplingWorkerForTestsMock: vi.fn(),
  startQuickServiceJobWorkerMock: vi.fn(async () => undefined),
  stopQuickServiceJobWorkerForTestsMock: vi.fn(),
  startScheduledTaskWorkerMock: vi.fn(async () => undefined),
  stopScheduledTaskWorkerForTestsMock: vi.fn(),
  startPlaybookRunWorkerMock: vi.fn(async () => undefined),
  stopPlaybookRunWorkerForTestsMock: vi.fn(),
  startSftpSyncJobWorkerMock: vi.fn(async () => undefined),
  stopSftpSyncJobWorkerForTestsMock: vi.fn(),
  startSftpStaleInventoryWorkerMock: vi.fn(async () => undefined),
  stopSftpStaleInventoryWorkerForTestsMock: vi.fn(),
  startVpsBackupJobWorkerMock: vi.fn(async () => undefined),
  stopVpsBackupForTestsMock: vi.fn(),
  startVpsBackupScheduleWorkerMock: vi.fn(async () => undefined),
  stopVpsBackupScheduleForTestsMock: vi.fn(),
  startTicketSlaWorkerMock: vi.fn(async () => undefined),
  stopTicketSlaWorkerForTestsMock: vi.fn(),
}));

vi.mock("@/lib/ai/ops/scan-worker", () => ({
  startAiOpsScanWorker: startAiOpsScanWorkerMock,
  stopAiOpsScanWorkerForTests: stopAiOpsScanWorkerForTestsMock,
}));
vi.mock("@/lib/health/alert-worker", () => ({
  startAlertEvaluationWorker: startAlertEvaluationWorkerMock,
  stopAlertEvaluationWorkerForTests: stopAlertEvaluationWorkerForTestsMock,
}));
vi.mock("@/lib/backup/job-worker", () => ({
  startBackupJobWorker: startBackupJobWorkerMock,
  stopBackupJobWorkerForTests: stopBackupJobWorkerForTestsMock,
}));
vi.mock("@/lib/backup/schedule-worker", () => ({
  startBackupScheduleWorker: startBackupScheduleWorkerMock,
  stopBackupScheduleWorkerForTests: stopBackupScheduleWorkerForTestsMock,
}));
vi.mock("@/lib/command/execution-worker", () => ({
  startCommandExecutionWorker: startCommandExecutionWorkerMock,
  stopCommandExecutionWorkerForTests: stopCommandExecutionWorkerForTestsMock,
}));
vi.mock("@/lib/command/worker", () => ({
  startCommandMaintenanceWorker: startCommandMaintenanceWorkerMock,
  stopCommandMaintenanceWorkerForTests: stopCommandMaintenanceWorkerForTestsMock,
}));
vi.mock("@/lib/health/sampling-worker", () => ({
  startHealthSamplingWorker: startHealthSamplingWorkerMock,
  stopHealthSamplingWorkerForTests: stopHealthSamplingWorkerForTestsMock,
}));
vi.mock("@/lib/downloads/execution-worker", () => ({
  startDownloadJobWorker: startDownloadJobWorkerMock,
  stopDownloadJobWorkerForTests: stopDownloadJobWorkerForTestsMock,
}));
vi.mock("@/lib/quick-service/job-worker", () => ({
  startQuickServiceJobWorker: startQuickServiceJobWorkerMock,
  stopQuickServiceJobWorkerForTests: stopQuickServiceJobWorkerForTestsMock,
}));
vi.mock("@/lib/scheduled-task/worker", () => ({
  startScheduledTaskWorker: startScheduledTaskWorkerMock,
  stopScheduledTaskWorkerForTests: stopScheduledTaskWorkerForTestsMock,
}));
vi.mock("@/lib/playbook/worker", () => ({
  startPlaybookRunWorker: startPlaybookRunWorkerMock,
  stopPlaybookRunWorkerForTests: stopPlaybookRunWorkerForTestsMock,
}));
vi.mock("@/lib/storage/sftp-sync-job", () => ({
  startSftpSyncJobWorker: startSftpSyncJobWorkerMock,
  stopSftpSyncJobWorkerForTests: stopSftpSyncJobWorkerForTestsMock,
}));
vi.mock("@/lib/storage/sftp-stale-inventory-job", () => ({
  startSftpStaleInventoryWorker: startSftpStaleInventoryWorkerMock,
  stopSftpStaleInventoryWorkerForTests: stopSftpStaleInventoryWorkerForTestsMock,
}));
vi.mock("@/lib/backup/vps-backup-job-worker", () => ({
  startVpsBackupJobWorker: startVpsBackupJobWorkerMock,
  stopVpsBackupForTests: stopVpsBackupForTestsMock,
}));
vi.mock("@/lib/backup/vps-backup-schedule-worker", () => ({
  startVpsBackupScheduleWorker: startVpsBackupScheduleWorkerMock,
  stopVpsBackupScheduleForTests: stopVpsBackupScheduleForTestsMock,
}));
vi.mock("@/lib/ticket/sla-worker", () => ({
  startTicketSlaWorker: startTicketSlaWorkerMock,
  stopTicketSlaWorkerForTests: stopTicketSlaWorkerForTestsMock,
}));

import {
  WORKER_REGISTRY,
  _resetWorkerRegistryForTests,
  getWorkerStatuses,
  startAllWorkers,
  startWorker,
  stopAllWorkers,
  stopWorker,
  type WorkerId,
} from "@/lib/workers/registry";

function resetAllMocks() {
  for (const m of [
    startAiOpsScanWorkerMock,
    startAlertEvaluationWorkerMock,
    startBackupJobWorkerMock,
    startBackupScheduleWorkerMock,
    startCommandExecutionWorkerMock,
    startCommandMaintenanceWorkerMock,
    startDownloadJobWorkerMock,
    startHealthSamplingWorkerMock,
    startQuickServiceJobWorkerMock,
    startScheduledTaskWorkerMock,
    startPlaybookRunWorkerMock,
    startSftpSyncJobWorkerMock,
    startSftpStaleInventoryWorkerMock,
    startVpsBackupJobWorkerMock,
    startVpsBackupScheduleWorkerMock,
    startTicketSlaWorkerMock,
  ]) {
    m.mockReset();
    m.mockResolvedValue(undefined);
  }
  for (const m of [
    stopAiOpsScanWorkerForTestsMock,
    stopAlertEvaluationWorkerForTestsMock,
    stopBackupJobWorkerForTestsMock,
    stopCommandExecutionWorkerForTestsMock,
    stopCommandMaintenanceWorkerForTestsMock,
    stopDownloadJobWorkerForTestsMock,
    stopHealthSamplingWorkerForTestsMock,
    stopQuickServiceJobWorkerForTestsMock,
    stopScheduledTaskWorkerForTestsMock,
    stopPlaybookRunWorkerForTestsMock,
    stopSftpSyncJobWorkerForTestsMock,
    stopSftpStaleInventoryWorkerForTestsMock,
    stopVpsBackupForTestsMock,
    stopVpsBackupScheduleForTestsMock,
    stopTicketSlaWorkerForTestsMock,
  ]) {
    m.mockReset();
  }
}

const EXPECTED_WORKER_IDS: WorkerId[] = [
  "ai-ops-scan",
  "alert-evaluation",
  "backup",
  "backup-schedule",
  "command-execution",
  "command-maintenance",
  "cost-snapshot",
  "health-sampling",
  "download-execution",
  "quick-service",
  "scheduled-task",
  "sftp-sync",
  "sftp-stale-inventory",
  "operation-task-retention",
  "playbook-run",
  "ticket-sla",
  "vps-backup",
  "vps-backup-schedule",
];

describe("worker registry", () => {
  beforeEach(() => {
    _resetWorkerRegistryForTests();
    resetAllMocks();
  });

  afterEach(() => {
    _resetWorkerRegistryForTests();
  });

  it("describes all 18 workers in the canonical order", () => {
    expect(WORKER_REGISTRY.map((w) => w.id)).toEqual(EXPECTED_WORKER_IDS);
    for (const w of WORKER_REGISTRY) {
      expect(w.label).toBeTruthy();
      expect(w.jobType).toBeTruthy();
      expect(typeof w.start).toBe("function");
      expect(typeof w.stop).toBe("function");
    }
  });

  it("getWorkerStatuses reports every worker as not started initially", () => {
    const statuses = getWorkerStatuses();
    expect(statuses).toHaveLength(18);
    expect(statuses.every((s) => s.started === false)).toBe(true);
  });

  it("startWorker marks the worker as started and is idempotent", async () => {
    await startWorker("alert-evaluation");
    expect(startAlertEvaluationWorkerMock).toHaveBeenCalledTimes(1);
    expect(getWorkerStatuses().find((s) => s.id === "alert-evaluation")?.started).toBe(true);

    // Second call should be a no-op.
    await startWorker("alert-evaluation");
    expect(startAlertEvaluationWorkerMock).toHaveBeenCalledTimes(1);
  });

  it("startWorker propagates failures but other workers stay healthy", async () => {
    startBackupJobWorkerMock.mockImplementation(() => {
      throw new Error("disk full");
    });

    const result = await startAllWorkers({ logger: () => {} });
    expect(result.failed.map((f) => f.id)).toEqual(["backup"]);
    expect(result.started).toEqual(
      expect.arrayContaining([
        "ai-ops-scan",
        "alert-evaluation",
        "command-execution",
        "command-maintenance",
        "download-execution",
        "quick-service",
        "scheduled-task",
        "sftp-sync",
        "sftp-stale-inventory",
        "operation-task-retention",
        "vps-backup",
        "vps-backup-schedule",
      ]),
    );
    expect(result.started).not.toContain("backup");
    // 17/18 should be reported started.
    const startedCount = getWorkerStatuses().filter((s) => s.started).length;
    expect(startedCount).toBe(17);
  });

  it("startAllWorkers starts every worker once", async () => {
    const result = await startAllWorkers({ logger: () => {} });
    expect(result.failed).toEqual([]);
    expect(result.started).toEqual(EXPECTED_WORKER_IDS);
    expect(startAlertEvaluationWorkerMock).toHaveBeenCalledTimes(1);
    expect(startBackupJobWorkerMock).toHaveBeenCalledTimes(1);
    expect(startBackupScheduleWorkerMock).toHaveBeenCalledTimes(1);
    expect(startDownloadJobWorkerMock).toHaveBeenCalledTimes(1);
  });

  it("stopWorker clears the started flag and invokes the worker's stop fn", () => {
    // start first
    return startWorker("scheduled-task").then(() => {
      stopWorker("scheduled-task");
      expect(stopScheduledTaskWorkerForTestsMock).toHaveBeenCalledTimes(1);
      expect(getWorkerStatuses().find((s) => s.id === "scheduled-task")?.started).toBe(false);
    });
  });

  it("stopAllWorkers invokes every worker's stop fn", async () => {
    await startAllWorkers({ logger: () => {} });
    stopAllWorkers();
    expect(stopAlertEvaluationWorkerForTestsMock).toHaveBeenCalledTimes(1);
    expect(stopBackupJobWorkerForTestsMock).toHaveBeenCalledTimes(1);
    expect(stopCommandExecutionWorkerForTestsMock).toHaveBeenCalledTimes(1);
    expect(stopCommandMaintenanceWorkerForTestsMock).toHaveBeenCalledTimes(1);
    expect(stopDownloadJobWorkerForTestsMock).toHaveBeenCalledTimes(1);
    expect(stopHealthSamplingWorkerForTestsMock).toHaveBeenCalledTimes(1);
    expect(stopQuickServiceJobWorkerForTestsMock).toHaveBeenCalledTimes(1);
    expect(stopScheduledTaskWorkerForTestsMock).toHaveBeenCalledTimes(1);
    expect(stopPlaybookRunWorkerForTestsMock).toHaveBeenCalledTimes(1);
    expect(stopSftpSyncJobWorkerForTestsMock).toHaveBeenCalledTimes(1);
  });

  it("startWorker throws on unknown worker id", async () => {
    await expect(startWorker("not-a-real-worker" as WorkerId)).rejects.toThrow(/Unknown worker/);
  });

  it("stopWorker throws on unknown worker id", () => {
    expect(() => stopWorker("not-a-real-worker" as WorkerId)).toThrow(/Unknown worker/);
  });

  it("getWorkerStatuses returns frozen-shape entries with all required fields", async () => {
    await startWorker("download-execution");
    const dl = getWorkerStatuses().find((s) => s.id === "download-execution");
    expect(dl).toEqual({
      id: "download-execution",
      label: "Download execution",
      jobType: "download.execute",
      started: true,
    });
  });
});
