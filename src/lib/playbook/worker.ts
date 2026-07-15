import { Prisma } from "@prisma/client";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

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

export async function processPlaybookRun(runId: string, jobId: string): Promise<{ status: "completed" | "failed"; summary: string }> {
  const run = await prisma.playbookRun.findUnique({
    where: { id: runId },
    include: { playbook: true },
  });
  if (!run) throw new Error(`playbook run not found: ${runId}`);
  if (["completed", "failed", "cancelled"].includes(run.status)) {
    return { status: run.status === "completed" ? "completed" : "failed", summary: run.errorMessage ?? run.status };
  }

  const claimed = await prisma.playbookRun.updateMany({
    where: { id: runId, status: { in: ["queued", "running"] } },
    data: { status: "running", startedAt: run.startedAt ?? new Date(), errorMessage: null },
  });
  if (claimed.count === 0) throw new Error(`playbook run is not claimable: ${runId}`);

  const requesterId = run.createdById ?? run.playbook.createdById;
  const executionState = run.executionState as unknown as ExecutionState | null;
  const steps = executionState?.schemaVersion === 1 && Array.isArray(executionState.stepsSnapshot)
    ? executionState.stepsSnapshot
    : run.playbook.steps as unknown as PlaybookStep[];
  if (steps.some((step) => step.type === "run_command") && !requesterId) {
    throw new Error("playbook command step requires a creator/requester");
  }

  const chain = await executePlaybookChain({
    playbook: {
      id: run.playbook.id,
      steps,
    },
    runId,
    dryRun: run.dryRun,
    requesterId: requesterId ?? "system",
    teamId: run.teamId,
    resumeResults: (run.stepResults ?? []) as unknown as PlaybookStepResult[],
    eventJobId: jobId,
    onProgress: (progress) => heartbeatJob(jobId, WORKER_ID, { leaseMs: LEASE_MS, progress }),
  });
  const failed = chain.results.find((result) => result.status === "failed");
  const status = failed ? "failed" : "completed";
  await prisma.playbookRun.update({
    where: { id: runId },
    data: {
      status,
      stepResults: chain.results as unknown as Prisma.InputJsonValue,
      errorMessage: failed?.error ?? null,
      completedAt: new Date(),
    },
  });
  return { status, summary: chain.summary };
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
    if (result.status === "failed") {
      await failJob(job.id, WORKER_ID, result.summary, { retryAfterMs: 5_000 });
    } else {
      await completeJob(job.id, WORKER_ID, result);
    }
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
