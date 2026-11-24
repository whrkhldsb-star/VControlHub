import { JobStatus, Prisma } from "@prisma/client";
import { checkSamplingClaim } from "@/lib/monitoring/sampling-claim";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { LeaseLostError, runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, failJob, failJobTerminal, heartbeatJob, pruneTerminalJobsByType } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { auditSystemAction } from "@/lib/audit/service";
import { createSingletonIntervalWorker, type SingletonIntervalWorkerState } from "@/lib/workers/singleton-interval-worker";

import { acquireMonitoredAdvisoryLock, AdvisoryLockBusyError } from "@/lib/concurrency/advisory-lock";
import { loadJobOwnerSession } from "@/lib/api-token/authorization";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager, liveCustomerRowsWhere } from "@/lib/auth/team-scope";
import { ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { assertRequesterMayExecuteCommand } from "@/lib/auth/command-execution-authz";
import { canAlertRuleTargetTeam } from "@/lib/alert/rule-scope";
import { projectPlaybookJobMessage, redactLegacyPlaybookMessages } from "./legacy-messages";
import { reconcileTerminalPlaybookJobs } from "./service";
import { executePlaybookChain } from "./executor";
import { redactWebhookResult } from "./webhook-result";
import type { PlaybookStep, PlaybookStepResult } from "./types";
import { toJsonValue } from "@/lib/db/json";

export const PLAYBOOK_RUN_JOB_TYPE = "playbook.run";

/**
 * Thrown when the run's requester no longer qualifies to execute commands at
 * execution time (disabled / demoted / removed from the run's team). Terminal —
 * must not requeue, since retrying under the same revoked identity would loop.
 */
export class PlaybookAuthorizationError extends ForbiddenError {
  constructor(reason: string) {
    super(reason);
    this.name = "PlaybookAuthorizationError";
  }
}

async function assertRunOwner(requesterId: string | null, teamId: string | null) {
  const owner = requesterId ? await loadJobOwnerSession(requesterId, teamId) : null;
  if (!owner || !sessionHasPermission(owner, "playbook:run") || (teamId === null && !isGlobalTeamManager(owner))) {
    throw new PlaybookAuthorizationError(t("backend.execution.ownerInactive"));
  }
}

/**
 * Live re-check that `requesterId` may execute a playbook's command steps is
 * delegated to the shared assertRequesterMayExecuteCommand (single source of
 * truth also used by the scheduled-task dispatcher).
 */
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:playbook-run:${process.pid}`;
const LEASE_MS = computeLeaseMs("playbook-run");
const logger = createLogger("playbook-run-worker");
// Durable playbook chains run frequently (every alert rule with playbooks can
// spawn one); keep only the newest COMPLETED rows so the jobs table stays
// bounded. FAILED/CANCELLED rows keep their 30d window via the job-maintenance
// terminal sweep (pruneTerminalJobs).
const PLAYBOOK_RUN_KEEP_LATEST = 25;

type Payload = { runId: string };
type ExecutionState =
  | { schemaVersion: 1; stepsSnapshot: PlaybookStep[] }
  | { schemaVersion: 2; stepsSnapshot: PlaybookStep[]; actorId: string | null; chainRetry: number; sourceRuleTeamId?: string | null };
type State = SingletonIntervalWorkerState;

const playbookRunWorker = createSingletonIntervalWorker({
  globalKey: "__vcontrolhubPlaybookRunWorker",
  resolveIntervalMs: () => config.worker.playbookRunIntervalMs,
  tick: (_state, reason) => {
    void runPlaybookRunWorkerOnce().catch((error) =>
      logger.error(reason === "startup" ? "playbook startup tick failed" : "playbook worker tick failed", error),
    );
  },
  onStarted: (_state, intervalMs) => {
    logger.info("playbook run worker started", { workerId: WORKER_ID, intervalMs });
  },
});

function getState(): State {
  return playbookRunWorker.getState();
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
    // A terminal row may predate webhook redaction. The job needs only its
    // failure status when reclaimed; never copy that historical error into a new event.
    summary: status === "failed" ? status : errorMessage ?? status,
  };
}

function isAlertRunContext(context: Prisma.JsonValue): context is Prisma.JsonObject {
  return context !== null && typeof context === "object" && !Array.isArray(context)
    && (context.type === "alert_rule" || context.type === "capacity_forecast");
}

async function assertAlertRunScope(context: Prisma.JsonValue, playbookId: string, runTeamId: string | null, sourceTeamId?: string | null) {
  if (!isAlertRunContext(context)) return;
  const [rule, playbook] = await Promise.all([
    typeof context.alertRuleId === "string" ? prisma.alertRule.findUnique({
      where: {
        id: context.alertRuleId, enabled: true, playbookIds: { has: playbookId }, ...liveCustomerRowsWhere(),
        AND: [{ OR: [
          { serverIds: { isEmpty: true } },
          ...(typeof context.serverId === "string" ? [{ serverIds: { has: context.serverId } }] : []),
        ] }],
      },
      select: { teamId: true },
    }) : null,
    prisma.playbook.findUnique({ where: { id: playbookId, enabled: true, ...liveCustomerRowsWhere() }, select: { teamId: true } }),
  ]);
  if (!rule || !playbook || (sourceTeamId !== undefined && rule.teamId !== sourceTeamId) || playbook.teamId !== runTeamId || !canAlertRuleTargetTeam(rule.teamId, playbook.teamId)) {
    throw new PlaybookAuthorizationError(t("backend.alert.oneOrMorePlaybookidsAreOutsideTheCurrent"));
  }
  const host = typeof context.serverId === "string" && await prisma.server.findFirst({
    where: { id: context.serverId, ...(runTeamId === null ? {} : { teamId: runTeamId }), enabled: true, ...liveCustomerRowsWhere() },
    select: { id: true },
  });
  if (!host) throw new PlaybookAuthorizationError(t("backend.alert.oneOrMoreServeridsAreOutsideTheCurrent"));
}

export async function processPlaybookRun(runId: string, jobId: string, signal?: AbortSignal, maxAttempts = 1, attempts?: number): Promise<{ status: "completed" | "failed"; summary: string }> {
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

  signal?.throwIfAborted();
  const state = run.executionState as unknown as ExecutionState | null;
  // Old jobs only have their requester FK and the budget recorded on the job.
  // An old run with no attributable actor cannot safely inherit an owner.
  const requesterId = state?.schemaVersion === 2 ? state.actorId : run.createdById;
  await assertRunOwner(requesterId, run.teamId);
  const steps = state ? state.stepsSnapshot : run.playbook.steps as unknown as PlaybookStep[];
  const chainRetry = state?.schemaVersion === 2 ? state.chainRetry : maxAttempts - 1;
  const sourceTeamId = state?.schemaVersion === 2 ? state.sourceRuleTeamId : undefined;
  const hasCommandStep = Array.isArray(steps) && steps.some((step) => step?.type === "run_command");
  if (hasCommandStep && !requesterId) {
    throw new Error("playbook command step requires a creator/requester");
  }

  // Live authorization re-check for command execution. The requester identity is
  // a snapshot taken at create/trigger time; by execution time (esp. cron/metric
  // triggers that fire indefinitely) the user may have been disabled, demoted,
  // or removed from the run's team. Without this, a triggered playbook keeps
  // executing commands under a revoked identity, and a playbook:manage user with
  // no command:execute could otherwise drive command execution. Re-verify at
  // execution against the live DB, fail terminally if the requester no longer
  // qualifies.
  if (hasCommandStep && !run.dryRun && requesterId) {
    const authz = await assertRequesterMayExecuteCommand(requesterId, run.teamId);
    if (!authz.ok) {
      throw new PlaybookAuthorizationError(authz.reason);
    }
  }

  // Serialize concurrent runs of the same playbook (shared target servers / commands).
  // Lock is per-playbook, so a reclaimed job may wait here while the original
  // worker finishes the same runId — re-check terminal status after acquire.
  const lock = await acquireMonitoredAdvisoryLock("playbook-execute", run.playbook.id);
  const generationKey = "playbook.lock." + run.playbook.id;
  signal = signal ? AbortSignal.any([signal, lock.signal]) : lock.signal;
  try {
    const latest = await prisma.playbookRun.findUnique({
      where: { id: runId },
      select: { status: true, errorMessage: true, stepResults: true, dryRun: true, teamId: true },
    });
    if (!latest) throw new Error(`playbook run not found: ${runId}`);
    if (["completed", "failed", "cancelled"].includes(latest.status)) {
      return terminalJobResult(latest.status, latest.errorMessage);
    }
    await assertAlertRunScope(run.triggerContext, run.playbook.id, latest.teamId, sourceTeamId);

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

    signal?.throwIfAborted();
    // Fence every older execution of this definition, even if its job lease still renews.
    await lock.assertHeld();
    const generations = await prisma.$queryRaw<{ id: string; version: number }[]>`WITH holder AS (
      INSERT INTO settings (key, value, "updatedAt") VALUES (${generationKey}, ${lock.generation}, (now() AT TIME ZONE 'UTC'))
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = (now() AT TIME ZONE 'UTC')
      WHERE settings.value::numeric < EXCLUDED.value::numeric RETURNING key
    ) UPDATE playbook_runs
      SET version = version + 1 WHERE "playbookId" = ${run.playbook.id} AND status = 'running'
      AND EXISTS (SELECT 1 FROM holder)
      AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = ${jobId} AND j.status = 'RUNNING' AND j."workerId" = ${WORKER_ID}
        AND j."leaseExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') ${attempts === undefined ? Prisma.empty : Prisma.sql`AND j.attempts = ${attempts}`})
      RETURNING id, version`;
    const version = generations.find((r) => r.id === runId)?.version;
    if (version === undefined) throw new LeaseLostError(jobId);
    const checkLease = async (progress?: string) => {
      signal?.throwIfAborted();
      const current = await prisma.playbookRun.count({ where: { id: runId, version, status: "running" } }).catch(() => 0);
      if (!current) throw new LeaseLostError(jobId);
      const lease = await heartbeatJob(jobId, WORKER_ID, { attempts, leaseMs: LEASE_MS, progress }).catch(() => null);
      if (lease?.count !== 1) throw new LeaseLostError(jobId);
      signal?.throwIfAborted();
    };
    const chain = await executePlaybookChain({
      signal, version, checkLease,
      checkWrite: async (tx) => {
        signal?.throwIfAborted();
        if (attempts !== undefined && signal) await checkSamplingClaim(tx, { jobId, workerId: WORKER_ID, attempts, signal });
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM playbook_runs
          WHERE id = ${runId} AND version = ${version} AND status = 'running'
          AND EXISTS (SELECT 1 FROM settings WHERE key = ${generationKey} AND value = ${lock.generation} FOR SHARE) FOR SHARE`;
        if (!rows.length) throw new LeaseLostError(jobId);
      },
      beforeDispatch: async () => {
        await checkLease();
        await assertRunOwner(requesterId, latest.teamId);
        await assertAlertRunScope(run.triggerContext, run.playbook.id, latest.teamId, sourceTeamId);
        await lock.assertHeld();
        const holder = await prisma.setting.findUnique({ where: { key: generationKey }, select: { value: true } });
        if (holder?.value !== lock.generation) throw new LeaseLostError(jobId);
        signal?.throwIfAborted();
      },
      playbook: {
        id: run.playbook.id,
        steps,
        chainRetry,
      },
      runId,
      dryRun: latest.dryRun,
      requesterId: requesterId ?? "system",
      teamId: latest.teamId,
      // Prefer post-lock stepResults so resume sees progress written by a prior owner.
      resumeResults: (latest.stepResults ?? run.stepResults ?? []) as unknown as PlaybookStepResult[],
      eventJobId: jobId,
      onProgress: (progress) => checkLease(projectPlaybookJobMessage(PLAYBOOK_RUN_JOB_TYPE, "heartbeat", progress)),
    });
    const stepResults = chain.results.map((result) => redactWebhookResult(
      Array.isArray(steps) ? steps.find((step) => step?.id === result.stepId) : undefined, result,
    ));
    const failed = stepResults.find((result) => result.status === "failed");
    const failedError = failed?.error ?? null;
    const status = failed ? "failed" : "completed";
    // CAS finalize: never overwrite cancelled (or an already-terminal row)
    // written while the chain was in flight.
    await checkLease();
    const finalized = await prisma.playbookRun.updateMany({
      where: { id: runId, version, status: { in: ["queued", "running"] } },
      data: {
        status,
        stepResults: toJsonValue(stepResults),
        errorMessage: failedError,
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
        failedError,
        stepCount: chain.results.length,
      },
      status === "completed" ? "INFO" : "WARNING",
      // Without the customer stamp this row lands at `teamId: null`, which
      // `teamWhere` treats as shared/legacy data — the step summary and error
      // text of one tenant's run would show up on every tenant's audit page.
      latest.teamId,
    );
    return { status, summary: chain.summary };
  } catch (error) {
    if (lock.signal.aborted) throw new LeaseLostError(jobId);
    throw error;
  } finally {
    await lock.release();
  }
}

async function handleJob(job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>): Promise<boolean> {
  try {
    const { runId } = parsePayload(job.payload);
    const result = await runWithLeaseHeartbeat({
      jobId: job.id,
      leaseMs: LEASE_MS,
      heartbeat: () => heartbeatJob(job.id, WORKER_ID, { attempts: job.attempts, leaseMs: LEASE_MS }),
      run: (signal) => processPlaybookRun(runId, job.id, signal, job.maxAttempts, job.attempts),
    });
    // Logical step failure already wrote PlaybookRun status=failed. Do NOT use
    // failJob() (requeues while attempts < maxAttempts). Terminal-fail the job
    // so Operation Tasks show FAILED, not a false COMPLETED success.
    if (result.status !== "completed") {
      await failJobTerminal(
        job.id,
        WORKER_ID,
        result.summary || `Playbook run ${result.status}`,
        { result, attempts: job.attempts },
      );
      return true;
    }
    await completeJob(job.id, WORKER_ID, result, job.attempts);
    return true;
  } catch (error) {
    if (error instanceof LeaseLostError) return true; // The new lease owner resolves it.
    if (error instanceof AdvisoryLockBusyError && error.namespace === "playbook-execute") {
      const { runId } = parsePayload(job.payload);
      await prisma.$transaction(async (tx) => {
        const now = new Date();
        const released = await tx.job.updateMany({
          where: { id: job.id, status: "RUNNING", attempts: job.attempts, workerId: WORKER_ID, leaseExpiresAt: { gt: now } },
          data: {
            status: "PENDING", availableAt: new Date(now.getTime() + 5_000), attempts: { decrement: 1 },
            workerId: null, workerHeartbeatAt: null, leaseExpiresAt: null,
          },
        });
        if (released.count) await tx.playbookRun.updateMany({ where: { id: runId, status: "running" }, data: { status: "queued" } });
      });
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    const payload = (() => { try { return parsePayload(job.payload); } catch { return null; } })();
    // Authorization failures are terminal: retrying under the same revoked
    // identity would loop forever. Mark the run failed and terminal-fail the job.
    const isTerminal = error instanceof PlaybookAuthorizationError;
    if (payload) {
      const willRetry = !isTerminal && job.attempts < job.maxAttempts;
      // `stepResults` is deliberately not written here. This branch used to read
      // the column and write the same value straight back, which is a no-op on a
      // quiet row and a lost update on a live one: the executor's persistProgress
      // can land between the read and this write, and then the stale snapshot
      // overwrites the newer progress — losing exactly the step history an
      // operator needs to see why the run died. The column already holds
      // whatever the executor last persisted; leave it alone.
      await prisma.playbookRun.updateMany({
        where: { id: payload.runId, status: { in: ["queued", "running"] } },
        data: {
          status: willRetry ? "queued" : "failed",
          errorMessage: message.slice(0, 2000),
          completedAt: willRetry ? null : new Date(),
        },
      });
    }
    if (isTerminal) {
      await failJobTerminal(job.id, WORKER_ID, message.slice(0, 2000), { attempts: job.attempts });
      logger.warn("playbook run terminally failed authorization", { jobId: job.id, error: message });
      return true;
    }
    // Infrastructure / unexpected throw: allow durable job retry via failJob.
    await failJob(job.id, WORKER_ID, message.slice(0, 2000), { retryAfterMs: 5_000, attempts: job.attempts });
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
    if (!job) return false;
    const handled = await handleJob(job);
    // Runs on both the success and the failure path (handleJob always resolves
    // the job to a terminal state or requeues it); best-effort so a prune
    // hiccup never masks the real job outcome.
    try {
      await pruneTerminalJobsByType({
        type: PLAYBOOK_RUN_JOB_TYPE,
        statuses: [JobStatus.COMPLETED],
        keepLatest: PLAYBOOK_RUN_KEEP_LATEST,
      });
    } catch (pruneError) {
      logger.warn("Failed to prune playbook.run completed jobs", {
        error: pruneError instanceof Error ? pruneError.message : String(pruneError),
      });
    }
    return handled;
  } finally {
    state.running = false;
  }
}

export async function startPlaybookRunWorker(options: { intervalMs?: number } = {}): Promise<State> {
  await redactLegacyPlaybookMessages();
  await reconcileTerminalPlaybookJobs(prisma);
  return (await playbookRunWorker.start(options)).state;
}

export function stopPlaybookRunWorkerForTests(): void {
  playbookRunWorker.stopForTests();
}
