import { Prisma } from "@prisma/client";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, failJob, failJobTerminal, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { auditSystemAction } from "@/lib/audit/service";

import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { executePlaybookChain } from "./executor";
import type { PlaybookStep, PlaybookStepResult } from "./types";

export const PLAYBOOK_RUN_JOB_TYPE = "playbook.run";
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:playbook-run:${process.pid}`;
const LEASE_MS = computeLeaseMs("playbook-run");
const logger = createLogger("playbook-run-worker");

type Payload = { runId: string };
type ExecutionState = { schemaVersion: 1; stepsSnapshot: PlaybookStep[] };
type State = { started: boolean; running: boolean; timer: NodeJS.Timeout | null };
type WorkerGlobal = typeof globalThis & { __vcontrolhubPlaybookRunWorker?: State };

function getState(): State {
  const globalState = globalThis as WorkerGlobal;
  globalState.__vcontrolhubPlaybookRunWorker ??= { started: false, running: false, timer: null };
  return globalState.__vcontrolhubPlaybookRunWorker;
}

function parsePayload(value: Prisma.JsonValue): Payload {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.runId !== "string" || !value.runId.trim()) {
    throw new Error("Playbook run job payload missing runId");
  }
  return { runId: value.runId.trim() };
}

function terminalJobResult(status: string, errorMessage: string | null | undefined): { status: "completed" | "failed"; summary: string } {
  // Job layer only distinguishes success vs non-success for completeJob();
  // cancelled maps to failed so the durable job is not requeued.
  return {
    status: status === "completed" ? "completed" : "failed",
    summary: errorMessage ?? status,
  };
}

export async function processPlaybookRun(runId: string, jobId: string): Promise<{ status: "completed" | "failed"; summary: string }> {
  const run = await prisma.playbookRun.findUnique({
    where: { id: runId },
    include: { playbook: true },
  });
  if (!run) throw new Error(`playbook run not found: ${runId}`);
  if (["completed", "failed", "cancelled"].includes(run.status)) {
    return terminalJobResult(run.status, run.errorMessage);
  }

  const claimed = await prisma.playbookRun.updateMany({
    where: { id: runId, status: { in: ["queued", "running"] } },
    data: { status: "running", startedAt: run.startedAt ?? new Date(), errorMessage: null },
  });
  if (claimed.count === 0) {
    // Cancel / terminal race: another writer moved the run out of claimable states.
    const latest = await prisma.playbookRun.findUnique({
      where: { id: runId },
      select: { status: true, errorMessage: true },
    });
    if (latest && ["completed", "failed", "cancelled"].includes(latest.status)) {
      return terminalJobResult(latest.status, latest.errorMessage);
    }
    throw new Error(`playbook run is not claimable: ${runId}`);
  }

  const requesterId = run.createdById ?? run.playbook.createdById;
  const executionState = run.executionState as unknown as ExecutionState | null;
  const steps = executionState?.schemaVersion === 1 && Array.isArray(executionState.stepsSnapshot)
    ? executionState.stepsSnapshot
    : run.playbook.steps as unknown as PlaybookStep[];
  if (steps.some((step) => step.type === "run_command") && !requesterId) {
    throw new Error("playbook command step requires a creator/requester");
  }

  // Serialize concurrent runs of the same playbook (shared target servers / commands).
  // Lock is per-playbook, so a reclaimed job may wait here while the original
  // worker finishes the same runId — re-check terminal status after acquire.
  const releaseLock = await acquireAdvisoryLock("playbook-execute", run.playbook.id);
  try {
    const latest = await prisma.playbookRun.findUnique({
      where: { id: runId },
      select: { status: true, errorMessage: true, stepResults: true, dryRun: true, teamId: true },
    });
    if (!latest) throw new Error(`playbook run not found: ${runId}`);
    if (["completed", "failed", "cancelled"].includes(latest.status)) {
      return terminalJobResult(latest.status, latest.errorMessage);
    }

    // Ensure we still own a claimable row before dispatching side effects.
    const stillClaimable = await prisma.playbookRun.updateMany({
      where: { id: runId, status: { in: ["queued", "running"] } },
      data: { status: "running" },
    });
    if (stillClaimable.count === 0) {
      const after = await prisma.playbookRun.findUnique({
        where: { id: runId },
        select: { status: true, errorMessage: true },
      });
      if (after && ["completed", "failed", "cancelled"].includes(after.status)) {
        return terminalJobResult(after.status, after.errorMessage);
      }
      throw new Error(`playbook run is not claimable after lock: ${runId}`);
    }

    const chain = await executePlaybookChain({
      playbook: {
        id: run.playbook.id,
        steps,
      },
      runId,
      dryRun: latest.dryRun,
      requesterId: requesterId ?? "system",
      teamId: latest.teamId,
      // Prefer post-lock stepResults so resume sees progress written by a prior owner.
      resumeResults: (latest.stepResults ?? run.stepResults ?? []) as unknown as PlaybookStepResult[],
      eventJobId: jobId,
      onProgress: (progress) => heartbeatJob(jobId, WORKER_ID, { leaseMs: LEASE_MS, progress }),
    });
    const failed = chain.results.find((result) => result.status === "failed");
    const status = failed ? "failed" : "completed";
    // CAS finalize: never overwrite cancelled (or an already-terminal row)
    // written while the chain was in flight.
    const finalized = await prisma.playbookRun.updateMany({
      where: { id: runId, status: { in: ["queued", "running"] } },
      data: {
        status,
        stepResults: chain.results as unknown as Prisma.InputJsonValue,
        errorMessage: failed?.error ?? null,
        completedAt: new Date(),
      },
    });
    if (finalized.count === 0) {
      const after = await prisma.playbookRun.findUnique({
        where: { id: runId },
        select: { status: true, errorMessage: true },
      });
      return terminalJobResult(after?.status ?? "cancelled", after?.errorMessage ?? "cancelled");
    }
    // Terminal audit: queue-time playbook.run exists, but operators had no
    // audit trail when a step failed after the job was already queued.
    await auditSystemAction(
      status === "completed" ? "playbook.run.completed" : "playbook.run.failed",
      {
        playbookId: run.playbook.id,
        runId,
        jobId,
        status,
        dryRun: latest.dryRun,
        summary: chain.summary,
        failedStepId: failed?.stepId ?? null,
        failedError: failed?.error ?? null,
        stepCount: chain.results.length,
      },
      status === "completed" ? "INFO" : "WARNING",
    );
    return { status, summary: chain.summary };
  } finally {
    await releaseLock();
  }
}

async function handleJob(job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>): Promise<boolean> {
  try {
    const { runId } = parsePayload(job.payload);
    const result = await runWithLeaseHeartbeat({
      jobId: job.id,
      leaseMs: LEASE_MS,
      heartbeat: () => heartbeatJob(job.id, WORKER_ID, { leaseMs: LEASE_MS }),
      run: () => processPlaybookRun(runId, job.id),
    });
    // Logical step failure already wrote PlaybookRun status=failed. Do NOT use
    // failJob() (requeues while attempts < maxAttempts). Terminal-fail the job
    // so Operation Tasks show FAILED, not a false COMPLETED success.
    if (result.status !== "completed") {
      await failJobTerminal(
        job.id,
        WORKER_ID,
        result.summary || `Playbook run ${result.status}`,
        { result },
      );
      return true;
    }
    await completeJob(job.id, WORKER_ID, result);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const payload = (() => { try { return parsePayload(job.payload); } catch { return null; } })();
    if (payload) {
      const current = await prisma.playbookRun.findUnique({ where: { id: payload.runId }, select: { stepResults: true } });
      await prisma.playbookRun.updateMany({
        where: { id: payload.runId, status: { in: ["queued", "running"] } },
        data: {
          status: job.attempts < job.maxAttempts ? "queued" : "failed",
          errorMessage: message.slice(0, 2000),
          completedAt: job.attempts < job.maxAttempts ? null : new Date(),
          ...(current?.stepResults ? { stepResults: current.stepResults as Prisma.InputJsonValue } : {}),
        },
      });
    }
    // Infrastructure / unexpected throw: allow durable job retry via failJob.
    await failJob(job.id, WORKER_ID, message.slice(0, 2000), { retryAfterMs: 5_000 });
    logger.error("playbook run job failed", { jobId: job.id, error: message });
    return true;
  }
}

export async function runPlaybookRunWorkerOnce(): Promise<boolean> {
  const state = getState();
  if (state.running) return false;
  state.running = true;
  try {
    const job = await claimNextJob({ workerId: WORKER_ID, types: [PLAYBOOK_RUN_JOB_TYPE], leaseMs: LEASE_MS });
    return job ? handleJob(job) : false;
  } finally {
    state.running = false;
  }
}

export async function startPlaybookRunWorker(options: { intervalMs?: number } = {}): Promise<State> {
  const state = getState();
  if (state.started) return state;
  state.started = true;
  const intervalMs = options.intervalMs ?? config.worker.playbookRunIntervalMs;
  void runPlaybookRunWorkerOnce().catch((error) => logger.error("playbook startup tick failed", error));
  state.timer = setInterval(() => {
    void runPlaybookRunWorkerOnce().catch((error) => logger.error("playbook worker tick failed", error));
  }, intervalMs);
  state.timer.unref?.();
  logger.info("playbook run worker started", { workerId: WORKER_ID, intervalMs });
  return state;
}

export function stopPlaybookRunWorkerForTests(): void {
  const state = getState();
  if (state.timer) clearInterval(state.timer);
  state.started = false;
  state.running = false;
  state.timer = null;
}
