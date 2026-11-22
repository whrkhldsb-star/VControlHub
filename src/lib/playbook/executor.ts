import type { Prisma } from "@prisma/client";
/** Durable Playbook chain executor.
 *
 * The parent `playbook.run` job owns the chain lease. Command steps create a
 * real CommandRequest and wait for its terminal state; the request id is
 * persisted before waiting so a reclaimed parent job resumes instead of
 * dispatching the command twice.
 */

import { canReceivePlaybookNotification } from "./notification-recipient";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { createCommandRequest, cancelCommandRequest } from "@/lib/command/service";
import { commandRequestTitle } from "@/lib/command/schema";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";
import { recordJobEvent } from "@/lib/job/events";
import { createNotification } from "@/lib/notification/service";
import { fetchPlaybookWebhook } from "./webhook-dispatch";

import type { PlaybookRecord, PlaybookStep, PlaybookStepResult } from "./types";
import { describeWebhookStep, redactWebhookResult } from "./webhook-result";
import { MAX_PLAYBOOK_RETRIES, playbookStepsSchema, playbookRetrySchema } from "./schema";
import { toJsonValue } from "@/lib/db/json";

const TRUNCATE_AT = 280;
const COMMAND_POLL_MS = 1_000;
const COMMAND_TERMINAL = new Set(["COMPLETED", "FAILED", "REJECTED", "CANCELLED"]);
const TIMEOUT_ACTOR_ID = "system:playbook-timeout";

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

class WebhookOutcomeUnknownError extends NonRetryableStepError {}

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
      return describeWebhookStep(step);
  }
}

function failedResult(step: Pick<PlaybookStep, "id">, error: unknown, startedAt: string): PlaybookStepResult {
  return {
    stepId: step.id,
    status: "failed",
    startedAt,
    completedAt: nowIso(),
    summary: "",
    ...(error instanceof CommandOutcomeUnknownError || error instanceof WebhookOutcomeUnknownError ? { outcomeUnknown: true } : {}),
    error: truncate(error instanceof Error ? error.message : String(error)),
  };
}

async function persistProgress(runId: string, results: PlaybookStepResult[], version?: number, db: Prisma.TransactionClient = prisma): Promise<void> {
  const persisted = await db.playbookRun.updateMany({
    where: { id: runId, status: "running", version },
    data: { stepResults: toJsonValue(results) },
  });
  if (persisted.count !== 1 && version !== undefined) throw new LeaseLostError(runId);
  if (persisted.count !== 1) throw new NonRetryableStepError("Playbook run is no longer running");
}

function substituteVariables(command: string, variables: Record<string, string>): string {
  return command.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key]! : match,
  );
}

type CommandWait = {
  signal?: AbortSignal;
  checkLease?: () => Promise<void>;
  onProgress?: (progress: string) => Promise<unknown>;
};

function waitForPoll(ms: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal!.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, ms);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Poll until the request is terminal or the deadline passes (null). */
async function pollUntilTerminal(
  commandRequestId: string,
  deadline: number,
  control: CommandWait,
): Promise<string | null> {
  let lastHeartbeat = 0;
  while (Date.now() < deadline) {
    control.signal?.throwIfAborted();
    await control.checkLease?.();
    const request = await prisma.commandRequest.findUnique({
      where: { id: commandRequestId },
      select: { status: true },
    });
    if (!request) throw new Error(`command request disappeared: ${commandRequestId}`);
    if (COMMAND_TERMINAL.has(request.status)) return request.status;
    const now = Date.now();
    // C4: keep durable playbook job lease alive during long SSH waits.
    if (control.onProgress && now - lastHeartbeat >= 15_000) {
      lastHeartbeat = now;
      await control.onProgress(`waiting command ${commandRequestId} (${request.status})`);
    }
    await waitForPoll(Math.max(1, Math.min(COMMAND_POLL_MS, deadline - Date.now())), control.signal);
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
async function assertFailedCommandCanRetry(commandRequestId: string, status: string): Promise<void> {
  const targets = await prisma.commandTarget.findMany({
    where: { commandRequestId }, select: { status: true, outcomeUnknown: true },
  });
  if (targets.some((target) => target.outcomeUnknown || !COMMAND_TERMINAL.has(target.status))) {
    throw new CommandOutcomeUnknownError(
      `command request ${commandRequestId} ended with ${status}, but a target could not confirm the remote process stopped; not retrying`,
    );
  }
  if (targets.some((target) => target.status === "COMPLETED")) {
    throw new NonRetryableStepError(`command request ${commandRequestId} already completed on a target; not retrying the batch`);
  }
  if (status === "REJECTED" || targets.some((target) => target.status === "REJECTED")) {
    throw new NonRetryableStepError(`command request ${commandRequestId} was rejected; not retrying`);
  }
  if (status === "CANCELLED" || targets.some((target) => target.status === "CANCELLED")) {
    // Only the caller that wins cancelCommandRequest's CAS records this log.
    // A timeout can race an operator's cancel, and a reclaimed worker has no
    // in-memory record of which one actually initiated the cancellation.
    const timeout = await prisma.executionLog.findFirst({
      where: { commandRequestId, serverId: null, summary: { startsWith: `Command cancellation requested by ${TIMEOUT_ACTOR_ID};` } },
      select: { id: true },
    });
    if (!timeout) throw new NonRetryableStepError(`command request ${commandRequestId} was cancelled; not retrying`);
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
    try {
      status = (await prisma.commandRequest.findUnique({ where: { id: commandRequestId }, select: { status: true } }))?.status;
      if (status && COMMAND_TERMINAL.has(status) && status !== "COMPLETED") {
        await assertFailedCommandCanRetry(commandRequestId, status);
      }
    } catch (lookupError) {
      if (lookupError instanceof NonRetryableStepError) throw lookupError;
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
  }
}

async function terminalOutcome(commandRequestId: string, status: string): Promise<string> {
  if (status === "COMPLETED") return `command request ${commandRequestId} completed`;
  await assertFailedCommandCanRetry(commandRequestId, status);
  throw new Error(`command request ${commandRequestId} ended with ${status}`);
}

async function waitForCommand(
  commandRequestId: string,
  timeoutSec: number,
  deadline: number,
  control: CommandWait,
): Promise<string> {
  const status = await pollUntilTerminal(commandRequestId, deadline, control);
  if (status) return terminalOutcome(commandRequestId, status);
  // Timeout: cancel the still-running request (kills the remote SSH subprocess)
  // BEFORE the step retries. Otherwise a step-level retry would create a second
  // CommandRequest and run the same (possibly destructive) command concurrently
  // with the first, which is still executing on the target.
  control.signal?.throwIfAborted();
  await control.checkLease?.();
  control.signal?.throwIfAborted();
  try {
    await cancelCommandRequest({
      commandRequestId,
      actorId: TIMEOUT_ACTOR_ID,
      reason: `Playbook step timed out after ${timeoutSec}s`,
    });
  } catch {
    // Best-effort: the request may already be terminal. Whatever happened, the
    // barrier below decides from the request's actual state.
  }
  // Cancelling a RUNNING request only moves it to CANCELLING; the target keeps
  // running until its executor acknowledges. Wait for a terminal state before
  // the step may retry, and refuse to retry at all if it never arrives.
  const settled = await pollUntilTerminal(commandRequestId, Date.now() + CANCEL_ACK_GRACE_MS, control);
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
  await assertFailedCommandCanRetry(commandRequestId, settled);
  throw new Error(`command request ${commandRequestId} timed out after ${timeoutSec}s (${settled})`);
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
  attemptStartedAt: string;
  version?: number;
  checkLease?: () => Promise<void>;
  checkWrite?: (tx: Prisma.TransactionClient) => Promise<void>;
  onProgress?: (progress: string) => Promise<unknown>;
  signal?: AbortSignal;
  beforeDispatch?: () => Promise<void>;
}): Promise<string> {
  input.signal?.throwIfAborted();
  const { step } = input;
  switch (step.type) {
    case "run_command": {
      const live = input.results.find((result) => result.stepId === step.id);
      const idempotencyKey = `playbook:${input.runId}:step:${step.id}:a${input.attempt}`;
      // A crash may leave the persisted deadline with no request ID. Look up
      // that exact attempt before deciding whether its deadline has expired.
      const lookup = live?.commandRequestId ? { id: live.commandRequestId } : live?.deadlineAt ? { idempotencyKey } : null;
      const prior = lookup && await prisma.commandRequest.findUnique({
        where: { ...lookup, requesterId: input.requesterId, teamId: input.teamId },
        select: { id: true, status: true, createdAt: true },
      });
      let commandRequestId = prior?.id;
      if (commandRequestId && prior && COMMAND_TERMINAL.has(prior.status)) return terminalOutcome(commandRequestId, prior.status);
      const startedAt = prior?.createdAt?.getTime() ?? Date.parse(live?.startedAt ?? input.attemptStartedAt);
      const deadline = live?.deadlineAt ? Date.parse(live.deadlineAt) : startedAt + step.timeoutSec * 1000;
      if (!Number.isFinite(deadline)) throw new NonRetryableStepError("Invalid command attempt deadline");
      if (!commandRequestId) {
        const running: PlaybookStepResult = {
          stepId: step.id, status: "running", startedAt: nowIso(), completedAt: "", summary: "",
          attempt: input.attempt, deadlineAt: new Date(deadline).toISOString(),
        };
        const index = input.results.findIndex((result) => result.stepId === step.id);
        if (index >= 0) input.results[index] = running;
        else input.results.push(running);
        await persistProgress(input.runId, input.results, input.version);
        await input.beforeDispatch?.();
        input.signal?.throwIfAborted();
        if (Date.now() >= deadline) throw new Error("Command attempt deadline expired");
        const payload = {
          title: commandRequestTitle(`Playbook ${input.playbookId}: `, step.name || step.id),
          command: substituteVariables(step.config.command, step.config.variables ?? {}),
          reason: `Playbook run ${input.runId}, step ${step.id}, attempt ${input.attempt + 1}`,
          submissionMode: "user" as const,
          requesterId: input.requesterId,
          teamId: input.teamId ?? null,
          // Distinct key per attempt so a FAILED first try is not idempotency-replayed
          // as a "success path" that immediately fails waitForCommand again.
          idempotencyKey,
          serverIds: step.config.serverIds,
        };
        const request = input.version === undefined ? await createCommandRequest(payload) : await createCommandRequest(
          payload, undefined, undefined, async (tx, id) => {
            await input.checkWrite?.(tx);
            input.signal?.throwIfAborted();
            if (Date.now() >= deadline) throw new Error("Command attempt deadline expired");
            running.commandRequestId = id;
            await persistProgress(input.runId, input.results, input.version, tx);
          },
        );
        commandRequestId = request.id;
        running.commandRequestId = commandRequestId;
        running.summary = `command request ${commandRequestId} dispatched (attempt ${input.attempt + 1})`;
        await persistProgress(input.runId, input.results, input.version);
      }
      return waitForCommand(commandRequestId, step.timeoutSec, deadline, input);
    }
    case "send_notification": {
      const deliveryId = "playbook-" + createHash("sha256").update(JSON.stringify([input.runId, step.id])).digest("hex");
      const prior = input.results.find((r) => r.stepId === step.id);
      const startedAt = prior?.startedAt ?? input.attemptStartedAt;
      const deadline = prior?.deadlineAt ? Date.parse(prior.deadlineAt) : Date.parse(startedAt) + step.timeoutSec * 1000;
      const timeout = new NonRetryableStepError(`Notification step timed out after ${step.timeoutSec}s`);
      const controller = new AbortController();
      const signal = input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal;
      const assertRecipient = async (db?: Prisma.TransactionClient) => {
        if (!await canReceivePlaybookNotification(step.config.recipientUserId, input.teamId, db)) {
          throw new NonRetryableStepError(`notification recipient outside customer scope: ${step.config.recipientUserId}`);
        }
      };
      let timer: ReturnType<typeof setTimeout> | undefined;
      let markerWrite: Promise<PlaybookStepResult> | undefined;
      try {
        if (!Number.isFinite(deadline) || Date.now() >= deadline) throw timeout;
        if (!prior?.deadlineAt) {
          const receipt: PlaybookStepResult = {
            stepId: step.id, status: "running", startedAt, completedAt: "", summary: "",
            ...prior, attempt: input.attempt, deadlineAt: new Date(deadline).toISOString(),
          };
          const index = input.results.findIndex((r) => r.stepId === step.id);
          if (index < 0) input.results.push(receipt);
          else input.results[index] = receipt;
          await persistProgress(input.runId, input.results, input.version);
          if (Date.now() >= deadline) throw timeout;
        }
        const expired = new Promise<never>((_, reject) => {
          timer = setTimeout(() => { controller.abort(timeout); reject(timeout); }, deadline - Date.now());
        });
        const deliver = async () => {
          await assertRecipient();
          signal.throwIfAborted();
          if (prior?.sideEffectDispatched) {
            const stored = await prisma.notification.findUnique({ where: { id: deliveryId }, select: { id: true } });
            if (!stored) throw new SideEffectAlreadyDispatchedError(`notification step ${step.id} was already dispatched; outcome unknown`);
          } else {
            markerWrite = markSideEffectDispatched({ ...input, signal, deadlineAt: new Date(deadline).toISOString() }, step.id);
            await markerWrite;
            await createNotification({
              userId: step.config.recipientUserId, type: "playbook", title: step.config.subject,
              message: step.config.body, teamId: input.teamId,
            }, deliveryId, {
              signal, deadline,
              beforeInsert: async (tx) => { await input.checkWrite?.(tx); await assertRecipient(tx); },
            });
          }
          if (Date.now() >= deadline) throw timeout;
          return `notification sent to ${step.config.recipientUserId}`;
        };
        return await Promise.race([deliver(), expired]);
      } catch (error) {
        input.signal?.throwIfAborted();
        if (error === timeout || Date.now() >= deadline) {
          const stored = await prisma.notification.findUnique({ where: { id: deliveryId }, select: { id: true } }).catch(() => null);
          if (stored) throw new NonRetryableStepError(`${timeout.message}; notification was stored`);
          throw timeout;
        }
        throw error;
      } finally {
        clearTimeout(timer);
        // A pending progress write must settle before the final failed receipt.
        if (controller.signal.aborted) await markerWrite?.catch(() => undefined);
      }
    }
    case "call_webhook": {
      // At-most-once guard (see send_notification): a webhook may be a
      // non-idempotent action (restart service, send SMS). Never auto-replay a
      // dispatched-but-unconfirmed webhook on reclaim.
      const priorWebhook = input.results.find((r) => r.stepId === step.id);
      const label = describeWebhookStep(step);
      if (priorWebhook?.sideEffectDispatched) {
        throw new SideEffectAlreadyDispatchedError(
          `${label}: already dispatched (at-most-once)`,
        );
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, step.timeoutSec) * 1_000);
      try {
        const marker = await markSideEffectDispatched(input, step.id);
        const result = await fetchPlaybookWebhook(step.config.url, {
          method: step.config.method,
          headers: step.config.headers ?? { "Content-Type": "application/json" },
          body: step.config.method === "GET" ? undefined : step.config.body,
          signal: input.signal ? AbortSignal.any([input.signal, controller.signal]) : controller.signal,
        }, input.beforeDispatch).catch((error) => {
          if (error instanceof ForbiddenError || error instanceof LeaseLostError) throw error;
          // An unexpected transport exception cannot prove that nothing was sent.
          throw new WebhookOutcomeUnknownError(`${label}: delivery outcome unknown`);
        });
        if (!result.ok) {
          if (result.dispatched !== false) throw new WebhookOutcomeUnknownError(`${label}: delivery outcome unknown`);
          delete marker.sideEffectDispatched;
          throw new Error(`${label}: blocked before dispatch`);
        }
        marker.httpStatus = result.response.status;
        const receipt = describeWebhookStep(step, marker);
        if (!result.response.ok) {
          // An HTTP error need not mean the remote action was rolled back.
          // Retry a confirmed HTTP failure only for an idempotent method.
          if (step.config.method !== "GET" && step.config.method !== "PUT") throw new NonRetryableStepError(receipt);
          delete marker.sideEffectDispatched;
          throw new Error(receipt);
        }
        return receipt;
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
  input: { runId: string; attempt: number; version?: number; deadlineAt?: string; results: PlaybookStepResult[]; existing?: PlaybookStepResult; signal?: AbortSignal; beforeDispatch?: () => Promise<void> },
  stepId: string,
): Promise<PlaybookStepResult> {
  const marker: PlaybookStepResult = {
    stepId,
    status: "running",
    startedAt: input.existing?.startedAt ?? nowIso(),
    completedAt: "",
    summary: `side effect dispatched`,
    sideEffectDispatched: true, attempt: input.attempt, ...(input.deadlineAt ? { deadlineAt: input.deadlineAt } : {}),
  };
  const index = input.results.findIndex((result) => result.stepId === stepId);
  if (index >= 0) input.results[index] = marker;
  else input.results.push(marker);
  input.signal?.throwIfAborted();
  await persistProgress(input.runId, input.results, input.version);
  await input.beforeDispatch?.();
  input.signal?.throwIfAborted();
  return marker;
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
      if (error instanceof NonRetryableStepError || error instanceof ForbiddenError || error instanceof LeaseLostError) throw error;
      if (attempt + 1 < attempts) await onRetry?.(error);
    }
  }
  throw lastError;
}

export async function executePlaybookChain(input: {
  playbook: Pick<PlaybookRecord, "id" | "steps"> & { chainRetry?: number };
  runId: string;
  dryRun: boolean;
  requesterId?: string;
  teamId?: string | null;
  resumeResults?: PlaybookStepResult[];
  version?: number;
  checkLease?: () => Promise<void>;
  checkWrite?: (tx: Prisma.TransactionClient) => Promise<void>;
  onProgress?: (progress: string) => Promise<unknown>;
  eventJobId?: string;
  signal?: AbortSignal;
  beforeDispatch?: () => Promise<void>;
}): Promise<{ results: PlaybookStepResult[]; summary: string }> {
  const { chainRetry = 0 } = input.playbook;
  let results: PlaybookStepResult[] = [];
  const rejectPlan = (message: string, stepId = "playbook") => ({
    results: [...results, failedResult({ id: stepId }, new Error(message), nowIso())],
    summary: message,
  });
  // Stored JSON and queued snapshots can predate import validation. Check the
  // entire budget before the first step can dispatch, including on reclaim.
  const parsed = playbookStepsSchema.safeParse(input.playbook.steps);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const index = issue.path[0];
    const step = typeof index === "number" ? input.playbook.steps[index] : undefined;
    const id = typeof step?.id === "string" ? step.id : undefined;
    if (issue.code === "custom" && issue.path[1] === "id") return rejectPlan("Step id is used by more than one step");
    if (step?.type === "call_webhook") return rejectPlan(describeWebhookStep(step, { status: "failed" }), id);
    return rejectPlan(`Invalid playbook ${issue.path.join(".") || "steps"}: ${issue.message}`, id);
  }
  const steps = parsed.data;
  results = (input.resumeResults ?? []).map((result) =>
    redactWebhookResult(steps.find((step) => step.id === result.stepId), result),
  );
  if (!playbookRetrySchema.safeParse(chainRetry).success) {
    return rejectPlan(`Playbook chainRetry must be an integer from 0 to ${MAX_PLAYBOOK_RETRIES}`);
  }
  const totalSteps = steps.length;
  let remaining = chainRetry;
  for (const prior of results) {
    const step = steps.find((item) => item.id === prior.stepId);
    if (step) remaining -= Math.floor((prior.attempt ?? 0) / (1 + step.retry));
  }

  for (let index = 0; index < totalSteps; index += 1) {
    const step = steps[index]!;
    const existingIndex = results.findIndex((result) => result.stepId === step.id);
    const existing = existingIndex >= 0 ? results[existingIndex] : undefined;
    if (existing?.outcomeUnknown || existing?.status === "failed") break;
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
        let attemptIndex = existing?.attempt ?? 0;
        const summary = await executeWithRetries(
          (1 + step.retry) * (1 + Math.max(0, remaining)) - (attemptIndex % (1 + step.retry)),
          async () => {
            const attemptStartedAt = nowIso();
            input.signal?.throwIfAborted();
            await input.beforeDispatch?.();
            input.signal?.throwIfAborted();
            const attempt = attemptIndex;
            return dispatchStep({
              step,
              playbookId: input.playbook.id,
              runId: input.runId,
              requesterId: input.requesterId ?? "system",
              teamId: input.teamId ?? null,
              results,
              existing,
              attempt, attemptStartedAt, version: input.version, checkLease: input.checkLease, checkWrite: input.checkWrite,
              onProgress: input.onProgress,
              signal: input.signal,
              beforeDispatch: input.beforeDispatch,
            });
          },
          async (error) => {
            const live = results.find((item) => item.stepId === step.id);
            // The lease/permission check can throw before dispatchStep has
            // examined a marker left by the previous worker.
            if (step.type === "call_webhook" && live?.sideEffectDispatched) {
              throw new WebhookOutcomeUnknownError(describeWebhookStep(step, { outcomeUnknown: true }));
            }
            if (step.type === "run_command") {
              // Before the link to the failed attempt's command is dropped:
              // every command it may have created must be known to have
              // stopped without completing. That includes one created under
              // its idempotency key whose id never reached `results` (the
              // create or the progress write threw).
              const failedAttempt = attemptIndex;
              const ids = new Set<string>();
              if (live?.commandRequestId) ids.add(live.commandRequestId);
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
            input.signal?.throwIfAborted();
            if ((attemptIndex + 1) % (1 + step.retry) === 0) remaining -= 1;
            attemptIndex += 1;
            const next: PlaybookStepResult = {
              stepId: step.id, status: "running", attempt: attemptIndex, startedAt: nowIso(), completedAt: "", summary: "",
            };
            const liveIndex = results.findIndex((item) => item.stepId === step.id);
            if (liveIndex >= 0) results[liveIndex] = next;
            else results.push(next);
            await persistProgress(input.runId, results, input.version);
          },
        );
        result = {
          stepId: step.id,
          status: "ok", attempt: attemptIndex,
          startedAt,
          completedAt: nowIso(),
          summary: truncate(summary),
          ...(existing?.commandRequestId ? { commandRequestId: existing.commandRequestId } : {}),
        };
        const live = results.find((item) => item.stepId === step.id);
        if (live?.attempt !== undefined) result.attempt = live.attempt;
        if (live?.commandRequestId) result.commandRequestId = live.commandRequestId;
        if (live?.httpStatus !== undefined) result.httpStatus = live.httpStatus;
      } catch (error) {
        if (error instanceof LeaseLostError) throw error;
        input.signal?.throwIfAborted();
        result = failedResult(step, error, startedAt);
        const live = results.find((item) => item.stepId === step.id);
        if (live?.attempt !== undefined) result.attempt = live.attempt;
        if (live?.commandRequestId) result.commandRequestId = live.commandRequestId;
        if (live?.httpStatus !== undefined) result.httpStatus = live.httpStatus;
        // Carry the marker onto the failed row. Without this the "we already
        // fired this webhook" fact is lost the moment the failure is recorded,
        // and a reclaim between this write and the run being finalized would
        // dispatch the side effect a second time.
        if (live?.sideEffectDispatched) result.sideEffectDispatched = true;
        // A lease check, progress write or transport exception can include
        // arbitrary context. Persist only the webhook's structured fields.
        if (step.type === "call_webhook") result.error = describeWebhookStep(step, result);
      }
    }

    if (existingIndex >= 0) results[existingIndex] = result;
    else {
      const liveIndex = results.findIndex((item) => item.stepId === step.id);
      if (liveIndex >= 0) results[liveIndex] = result;
      else results.push(result);
    }
    input.signal?.throwIfAborted();
    await persistProgress(input.runId, results, input.version);
    const progressLabel = step.type === "call_webhook" ? describeWebhookStep(step, result) : step.name || step.id;
    await input.onProgress?.(`step ${index + 1}/${totalSteps}: ${progressLabel} ${result.status}`);
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
