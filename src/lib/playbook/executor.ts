/** Durable Playbook chain executor.
 *
 * The parent `playbook.run` job owns the chain lease. Command steps create a
 * real CommandRequest and wait for its terminal state; the request id is
 * persisted before waiting so a reclaimed parent job resumes instead of
 * dispatching the command twice.
 */

import { prisma } from "@/lib/db";
import { createCommandRequest, cancelCommandRequest } from "@/lib/command/service";
import { recordJobEvent } from "@/lib/job/events";
import { fetchWebhookSafely } from "@/lib/security/webhook-url";

import type { PlaybookRecord, PlaybookStep, PlaybookStepResult } from "./types";
import { toJsonValue } from "@/lib/db/json";

const TRUNCATE_AT = 280;
const COMMAND_POLL_MS = 1_000;
const COMMAND_TERMINAL = new Set(["COMPLETED", "FAILED", "REJECTED", "CANCELLED"]);

/**
 * Raised when a reclaimed run finds a step whose non-idempotent side effect was
 * already dispatched (see {@link markSideEffectDispatched}).
 *
 * This has to be distinguishable from an ordinary step failure. `step.retry` may
 * be up to 5, and the retry loop's `onRetry` deletes the step's row so the next
 * attempt starts clean — which would delete the very marker the guard reads and
 * then re-fire the webhook/notification the guard just refused to send. So
 * {@link executeWithRetries} treats this error as terminal: no retry, no splice.
 */
class NonRetryableStepError extends Error {}

class SideEffectAlreadyDispatchedError extends NonRetryableStepError {
  constructor(message: string) {
    super(message);
    this.name = "SideEffectAlreadyDispatchedError";
  }
}

/**
 * A timed-out command was cancelled but never confirmed terminal: it may still
 * be running on the target. Retrying would start a second copy of a possibly
 * non-idempotent command concurrently, so the step fails without retrying.
 */
class CommandOutcomeUnknownError extends NonRetryableStepError {
  constructor(message: string) {
    super(message);
    this.name = "CommandOutcomeUnknownError";
  }
}

/** How long a cancelled command may take to reach a terminal state. */
const CANCEL_ACK_GRACE_MS = 60_000;

function truncate(input: string, max = TRUNCATE_AT): string {
  return input.length <= max ? input : `${input.slice(0, max)}…`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function describeStep(step: PlaybookStep): string {
  switch (step.type) {
    case "run_command":
      return `run_command "${truncate(step.config.command, 80)}" on ${step.config.serverIds.length} server(s)`;
    case "send_notification":
      return `send_notification "${truncate(step.config.subject, 60)}" to ${step.config.recipientUserId}`;
    case "call_webhook":
      return `call_webhook ${step.config.method} ${truncate(step.config.url, 80)}`;
  }
}

function failedResult(step: PlaybookStep, error: unknown, startedAt: string): PlaybookStepResult {
  return {
    stepId: step.id,
    status: "failed",
    startedAt,
    completedAt: nowIso(),
    summary: "",
    error: truncate(error instanceof Error ? error.message : String(error)),
  };
}

async function persistProgress(runId: string, results: PlaybookStepResult[]): Promise<void> {
  await prisma.playbookRun.updateMany({
    where: { id: runId, status: "running" },
    data: { stepResults: toJsonValue(results) },
  });
}

function substituteVariables(command: string, variables: Record<string, string>): string {
  return command.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key]! : match,
  );
}

/** Poll until the request is terminal or the deadline passes (null). */
async function pollUntilTerminal(
  commandRequestId: string,
  deadline: number,
  onProgress?: (progress: string) => Promise<unknown>,
): Promise<string | null> {
  let lastHeartbeat = 0;
  while (Date.now() <= deadline) {
    const request = await prisma.commandRequest.findUnique({
      where: { id: commandRequestId },
      select: { status: true },
    });
    if (!request) throw new Error(`command request disappeared: ${commandRequestId}`);
    if (COMMAND_TERMINAL.has(request.status)) return request.status;
    const now = Date.now();
    // C4: keep durable playbook job lease alive during long SSH waits.
    if (onProgress && now - lastHeartbeat >= 15_000) {
      lastHeartbeat = now;
      await onProgress(`waiting command ${commandRequestId} (${request.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_MS));
  }
  return null;
}

/**
 * FAILED/CANCELLED is also how a lost executor or an Agent that never
 * confirmed a stop is recorded; such a target may still be running remotely.
 * Every non-COMPLETED terminal state goes through this before any further
 * attempt may be created — after a plain wait, after a timeout's cancellation
 * wait, and when a reclaimed run finds its previous request already terminal.
 */
async function assertOutcomeKnown(commandRequestId: string, status: string): Promise<void> {
  const unknown = await prisma.commandTarget.count({ where: { commandRequestId, outcomeUnknown: true } });
  if (unknown > 0) {
    throw new CommandOutcomeUnknownError(
      `command request ${commandRequestId} ended with ${status}, but ${unknown} target(s) could not confirm the remote process stopped; not retrying`,
    );
  }
}

/**
 * Gate before a run_command step may retry after ANY error — including a
 * database read that failed while waiting, or a progress write that failed
 * right after the command was created. A retry creates a new command, so it
 * is only safe when every command of the failed attempt is known to have
 * ended without completing and without an unconfirmed target. A command that
 * is still running, one that completed (the step failed afterwards), or a
 * state that cannot be read now, stops the step instead.
 */
async function assertCommandRetryable(commandRequestIds: string[], cause: unknown): Promise<void> {
  const reason = cause instanceof Error ? cause.message : String(cause);
  for (const commandRequestId of commandRequestIds) {
    let status: string | undefined;
    let unknown = 0;
    try {
      status = (await prisma.commandRequest.findUnique({ where: { id: commandRequestId }, select: { status: true } }))?.status;
      if (status && COMMAND_TERMINAL.has(status) && status !== "COMPLETED") {
        unknown = await prisma.commandTarget.count({ where: { commandRequestId, outcomeUnknown: true } });
      }
    } catch (lookupError) {
      throw new CommandOutcomeUnknownError(
        `step failed (${reason}) and the state of command request ${commandRequestId} could not be read (${lookupError instanceof Error ? lookupError.message : String(lookupError)}); not retrying while it may still be running`,
      );
    }
    if (!status || !COMMAND_TERMINAL.has(status)) {
      throw new CommandOutcomeUnknownError(
        `step failed (${reason}) while command request ${commandRequestId} is ${status ?? "missing"}; not retrying while it may still be running`,
      );
    }
    if (status === "COMPLETED") {
      throw new CommandOutcomeUnknownError(
        `step failed (${reason}) after command request ${commandRequestId} completed; not running the command again`,
      );
    }
    if (unknown > 0) {
      throw new CommandOutcomeUnknownError(
        `command request ${commandRequestId} ended with ${status}, but ${unknown} target(s) could not confirm the remote process stopped; not retrying`,
      );
    }
  }
}

async function terminalOutcome(commandRequestId: string, status: string): Promise<string> {
  if (status === "COMPLETED") return `command request ${commandRequestId} completed`;
  await assertOutcomeKnown(commandRequestId, status);
  throw new Error(`command request ${commandRequestId} ended with ${status}`);
}

async function waitForCommand(
  commandRequestId: string,
  timeoutSec: number,
  onProgress?: (progress: string) => Promise<unknown>,
): Promise<string> {
  const status = await pollUntilTerminal(commandRequestId, Date.now() + Math.max(1, timeoutSec) * 1_000, onProgress);
  if (status) return terminalOutcome(commandRequestId, status);
  // Timeout: cancel the still-running request (kills the remote SSH subprocess)
  // BEFORE the step retries. Otherwise a step-level retry would create a second
  // CommandRequest and run the same (possibly destructive) command concurrently
  // with the first, which is still executing on the target.
  try {
    await cancelCommandRequest({
      commandRequestId,
      actorId: "system:playbook-timeout",
      reason: `Playbook step timed out after ${timeoutSec}s`,
    });
  } catch {
    // Best-effort: the request may already be terminal. Whatever happened, the
    // barrier below decides from the request's actual state.
  }
  // Cancelling a RUNNING request only moves it to CANCELLING; the target keeps
  // running until its executor acknowledges. Wait for a terminal state before
  // the step may retry, and refuse to retry at all if it never arrives.
  const settled = await pollUntilTerminal(commandRequestId, Date.now() + CANCEL_ACK_GRACE_MS, onProgress);
  if (!settled) {
    throw new CommandOutcomeUnknownError(
      `command request ${commandRequestId} timed out after ${timeoutSec}s and its cancellation was not confirmed within ${CANCEL_ACK_GRACE_MS / 1000}s; outcome unknown, not retrying while it may still be running`,
    );
  }
  // It finished on its own while being cancelled: that is the real result.
  if (settled === "COMPLETED") return terminalOutcome(commandRequestId, settled);
  // The cancellation may have ended as FAILED/CANCELLED with a target whose
  // stop was never confirmed (e.g. an Agent that did not acknowledge): that
  // is not a clean timeout a retry may follow.
  await assertOutcomeKnown(commandRequestId, settled);
  throw new Error(`command request ${commandRequestId} timed out after ${timeoutSec}s (${settled})`);
}

async function resolveResumableCommandRequestId(
  candidateId: string | undefined,
): Promise<string | undefined> {
  if (!candidateId) return undefined;
  const request = await prisma.commandRequest.findUnique({
    where: { id: candidateId },
    select: { status: true },
  });
  if (!request) return undefined;
  // Resume only non-terminal (or completed) requests. A FAILED/REJECTED/CANCELLED
  // id must not be reused: createCommandRequest would also idempotency-replay it.
  if (request.status === "COMPLETED") return candidateId;
  if (COMMAND_TERMINAL.has(request.status)) {
    // Dropping it would let the reclaimed run create a fresh attempt while the
    // previous one may still be running on the target.
    await assertOutcomeKnown(candidateId, request.status);
    return undefined;
  }
  return candidateId;
}

async function dispatchStep(input: {
  step: PlaybookStep;
  playbookId: string;
  runId: string;
  requesterId: string;
  teamId: string | null;
  results: PlaybookStepResult[];
  existing?: PlaybookStepResult;
  /** 0-based attempt within step.retry+1; each attempt gets a distinct command + idempotency key. */
  attempt: number;
  onProgress?: (progress: string) => Promise<unknown>;
}): Promise<string> {
  const { step } = input;
  switch (step.type) {
    case "run_command": {
      // Attempt 0 may resume a prior commandRequestId (durable reclaim mid-wait).
      // Later attempts must not inherit a failed request id from `existing` or results.
      const liveId = input.results.find((result) => result.stepId === step.id)?.commandRequestId;
      const resumeCandidate =
        input.attempt === 0
          ? (liveId ?? input.existing?.commandRequestId)
          : liveId;
      let commandRequestId = await resolveResumableCommandRequestId(resumeCandidate);
      if (commandRequestId) {
        const request = await prisma.commandRequest.findUnique({
          where: { id: commandRequestId },
          select: { status: true },
        });
        if (request?.status === "COMPLETED") {
          return `command request ${commandRequestId} completed`;
        }
      }
      if (!commandRequestId) {
        const request = await createCommandRequest({
          title: `Playbook ${input.playbookId}: ${step.name || step.id}`,
          command: substituteVariables(step.config.command, step.config.variables ?? {}),
          reason: `Playbook run ${input.runId}, step ${step.id}, attempt ${input.attempt + 1}`,
          submissionMode: "user",
          requesterId: input.requesterId,
          teamId: input.teamId ?? null,
          // Distinct key per attempt so a FAILED first try is not idempotency-replayed
          // as a "success path" that immediately fails waitForCommand again.
          idempotencyKey: `playbook:${input.runId}:step:${step.id}:a${input.attempt}`,
          serverIds: step.config.serverIds,
        });
        commandRequestId = request.id;
        const running: PlaybookStepResult = {
          stepId: step.id,
          status: "running",
          startedAt: input.existing?.startedAt ?? nowIso(),
          completedAt: "",
          summary: `command request ${commandRequestId} dispatched (attempt ${input.attempt + 1})`,
          commandRequestId,
        };
        const index = input.results.findIndex((result) => result.stepId === step.id);
        if (index >= 0) input.results[index] = running;
        else input.results.push(running);
        await persistProgress(input.runId, input.results);
      }
      return waitForCommand(commandRequestId, step.timeoutSec, input.onProgress);
    }
    case "send_notification": {
      // At-most-once guard: if a prior attempt already dispatched this step but
      // the worker crashed/lost its lease before recording success, do NOT
      // blindly re-send on reclaim — fail the step instead. Re-sending would
      // spam a duplicate notification. Only attempt 0 can inherit a prior
      // marker (later attempts within this worker are deliberately fresh).
      // The marker is honoured whatever status it carries: "running" means the
      // outcome is unknown, "failed" means the notification definitely went out
      // and only the recording of it did not.
      const priorNotify = input.results.find((r) => r.stepId === step.id);
      if (input.attempt === 0 && priorNotify?.sideEffectDispatched) {
        throw new SideEffectAlreadyDispatchedError(
          `notification step ${step.id} was already dispatched in a prior attempt; not re-sending (at-most-once)`,
        );
      }
      // Defense-in-depth: write-time service asserts actor scope; when the run
      // carries a teamId, also require the recipient to be a team member so a
      // legacy/stale playbook step cannot spam out-of-team inboxes.
      if (input.teamId) {
        const membership = await prisma.teamMember.findUnique({
          where: {
            teamId_userId: {
              teamId: input.teamId,
              userId: step.config.recipientUserId,
            },
          },
          select: { userId: true },
        });
        if (!membership) {
          throw new Error(
            `notification recipient outside customer scope: ${step.config.recipientUserId}`,
          );
        }
      }
      // Dispatch-before-persist: mark the step as dispatched BEFORE the side
      // effect so a crash after create() is recognized on reclaim.
      await markSideEffectDispatched(input, step.id);
      await prisma.notification.create({
        data: {
          userId: step.config.recipientUserId,
          type: "playbook",
          title: step.config.subject,
          message: step.config.body,
          teamId: input.teamId,
        },
      });
      return `notification sent to ${step.config.recipientUserId}`;
    }
    case "call_webhook": {
      // At-most-once guard (see send_notification): a webhook may be a
      // non-idempotent action (restart service, send SMS). Never auto-replay a
      // dispatched-but-unconfirmed webhook on reclaim.
      const priorWebhook = input.results.find((r) => r.stepId === step.id);
      if (input.attempt === 0 && priorWebhook?.sideEffectDispatched) {
        throw new SideEffectAlreadyDispatchedError(
          `webhook step ${step.id} was already dispatched in a prior attempt; not re-calling (at-most-once)`,
        );
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, step.timeoutSec) * 1_000);
      try {
        await markSideEffectDispatched(input, step.id);
        const result = await fetchWebhookSafely(step.config.url, {
          method: step.config.method,
          headers: step.config.headers ?? { "Content-Type": "application/json" },
          body: step.config.method === "GET" ? undefined : step.config.body,
          signal: controller.signal,
        });
        if (!result.ok) throw new Error(result.error ?? `webhook URL blocked: ${step.config.url}`);
        if (!result.response.ok) {
          throw new Error(`webhook ${step.config.method} ${step.config.url} returned ${result.response.status} ${result.response.statusText}`);
        }
        return `webhook ${step.config.method} ${step.config.url} → ${result.response.status}`;
      } finally {
        clearTimeout(timer);
      }
    }
  }
}

/**
 * Persist a "running + sideEffectDispatched" marker for a step BEFORE its
 * non-idempotent side effect fires. On worker reclaim, dispatchStep sees this
 * marker and refuses to replay the side effect (at-most-once), instead of
 * silently double-sending a webhook/notification.
 */
async function markSideEffectDispatched(
  input: { runId: string; results: PlaybookStepResult[]; existing?: PlaybookStepResult },
  stepId: string,
): Promise<void> {
  const marker: PlaybookStepResult = {
    stepId,
    status: "running",
    startedAt: input.existing?.startedAt ?? nowIso(),
    completedAt: "",
    summary: `side effect dispatched`,
    sideEffectDispatched: true,
  };
  const index = input.results.findIndex((result) => result.stepId === stepId);
  if (index >= 0) input.results[index] = marker;
  else input.results.push(marker);
  await persistProgress(input.runId, input.results);
}

async function executeWithRetries<T>(
  attempts: number,
  run: () => Promise<T>,
  onRetry?: (error: unknown) => Promise<void>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      lastError = error;
      // A refusal to replay a dispatched side effect must not be retried (the
      // retry would undo the marker and fire it anyway), nor may a command whose
      // cancellation was never confirmed (it may still be running).
      if (error instanceof NonRetryableStepError) throw error;
      if (attempt + 1 < attempts) await onRetry?.(error);
    }
  }
  throw lastError;
}

export async function executePlaybookChain(input: {
  playbook: Pick<PlaybookRecord, "id" | "steps">;
  runId: string;
  dryRun: boolean;
  requesterId?: string;
  teamId?: string | null;
  resumeResults?: PlaybookStepResult[];
  onProgress?: (progress: string) => Promise<unknown>;
  eventJobId?: string;
}): Promise<{ results: PlaybookStepResult[]; summary: string }> {
  const results = [...(input.resumeResults ?? [])];
  const totalSteps = input.playbook.steps.length;

  for (let index = 0; index < totalSteps; index += 1) {
    const step = input.playbook.steps[index]!;
    const existingIndex = results.findIndex((result) => result.stepId === step.id);
    const existing = existingIndex >= 0 ? results[existingIndex] : undefined;
    if (existing && ["ok", "dry_run"].includes(existing.status)) continue;

    const startedAt = existing?.startedAt || nowIso();
    let result: PlaybookStepResult;
    if (input.dryRun) {
      result = {
        stepId: step.id,
        status: "dry_run",
        startedAt,
        completedAt: nowIso(),
        summary: `dry-run: ${describeStep(step)}`,
      };
    } else {
      try {
        let attemptIndex = 0;
        const summary = await executeWithRetries(
          Math.max(1, step.retry + 1),
          () => {
            const attempt = attemptIndex;
            attemptIndex += 1;
            return dispatchStep({
              step,
              playbookId: input.playbook.id,
              runId: input.runId,
              requesterId: input.requesterId ?? "system",
              teamId: input.teamId ?? null,
              results,
              existing,
              attempt,
              onProgress: input.onProgress,
            });
          },
          async (error) => {
            if (step.type === "run_command") {
              // Before the link to the failed attempt's command is dropped:
              // every command it may have created must be known to have
              // stopped without completing. That includes one created under
              // its idempotency key whose id never reached `results` (the
              // create or the progress write threw).
              const failedAttempt = attemptIndex - 1;
              const ids = new Set<string>();
              const live = results.find((item) => item.stepId === step.id)?.commandRequestId;
              if (live) ids.add(live);
              try {
                const byKey = await prisma.commandRequest.findUnique({
                  where: { idempotencyKey: `playbook:${input.runId}:step:${step.id}:a${failedAttempt}` },
                  select: { id: true },
                });
                if (byKey) ids.add(byKey.id);
              } catch (lookupError) {
                throw new CommandOutcomeUnknownError(
                  `step failed (${error instanceof Error ? error.message : String(error)}) and its command could not be looked up (${lookupError instanceof Error ? lookupError.message : String(lookupError)}); not retrying`,
                );
              }
              await assertCommandRetryable([...ids], error);
            }
            // Drop the failed attempt's running row so the next attempt can
            // create a fresh commandRequestId (not resume the FAILED one).
            const liveIndex = results.findIndex((item) => item.stepId === step.id);
            if (liveIndex >= 0) {
              results.splice(liveIndex, 1);
              await persistProgress(input.runId, results);
            }
          },
        );
        result = {
          stepId: step.id,
          status: "ok",
          startedAt,
          completedAt: nowIso(),
          summary: truncate(summary),
          ...(existing?.commandRequestId ? { commandRequestId: existing.commandRequestId } : {}),
        };
        const live = results.find((item) => item.stepId === step.id);
        if (live?.commandRequestId) result.commandRequestId = live.commandRequestId;
      } catch (error) {
        result = failedResult(step, error, startedAt);
        const live = results.find((item) => item.stepId === step.id);
        if (live?.commandRequestId) result.commandRequestId = live.commandRequestId;
        // Carry the marker onto the failed row. Without this the "we already
        // fired this webhook" fact is lost the moment the failure is recorded,
        // and a reclaim between this write and the run being finalized would
        // dispatch the side effect a second time.
        if (live?.sideEffectDispatched) result.sideEffectDispatched = true;
      }
    }

    if (existingIndex >= 0) results[existingIndex] = result;
    else {
      const liveIndex = results.findIndex((item) => item.stepId === step.id);
      if (liveIndex >= 0) results[liveIndex] = result;
      else results.push(result);
    }
    await persistProgress(input.runId, results);
    await input.onProgress?.(`step ${index + 1}/${totalSteps}: ${step.name || step.id} ${result.status}`);
    await recordJobEvent({
      jobId: input.eventJobId ?? input.runId,
      type: "progress",
      level: result.status === "failed" ? "warn" : "info",
      message: `step ${step.id} ${result.status} (${index + 1}/${totalSteps})`,
      payload: { stepId: step.id, status: result.status, stepIndex: index, totalSteps },
    });
    if (result.status === "failed" && !input.dryRun) break;
  }

  const okCount = results.filter((result) => result.status === "ok").length;
  const failedCount = results.filter((result) => result.status === "failed").length;
  const dryRunCount = results.filter((result) => result.status === "dry_run").length;
  return {
    results,
    summary: input.dryRun
      ? `dry-run: ${dryRunCount}/${totalSteps} steps planned`
      : `completed ${okCount}/${totalSteps} steps${failedCount ? `, ${failedCount} failed` : ""}`,
  };
}
