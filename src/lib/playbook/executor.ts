/** Durable Playbook chain executor.
 *
 * The parent `playbook.run` job owns the chain lease. Command steps create a
 * real CommandRequest and wait for its terminal state; the request id is
 * persisted before waiting so a reclaimed parent job resumes instead of
 * dispatching the command twice.
 */
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { recordJobEvent } from "@/lib/job/events";
import { fetchWebhookSafely } from "@/lib/security/webhook-url";

import type { PlaybookRecord, PlaybookStep, PlaybookStepResult } from "./types";

const TRUNCATE_AT = 280;
const COMMAND_POLL_MS = 1_000;
const COMMAND_TERMINAL = new Set(["COMPLETED", "FAILED", "REJECTED", "CANCELLED"]);

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
    data: { stepResults: results as unknown as Prisma.InputJsonValue },
  });
}

function substituteVariables(command: string, variables: Record<string, string>): string {
  return command.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key]! : match,
  );
}

async function waitForCommand(
  commandRequestId: string,
  timeoutSec: number,
  onProgress?: (progress: string) => Promise<unknown>,
): Promise<string> {
  const deadline = Date.now() + Math.max(1, timeoutSec) * 1_000;
  let lastHeartbeat = 0;
  while (Date.now() <= deadline) {
    const request = await prisma.commandRequest.findUnique({
      where: { id: commandRequestId },
      select: { status: true },
    });
    if (!request) throw new Error(`command request disappeared: ${commandRequestId}`);
    if (COMMAND_TERMINAL.has(request.status)) {
      if (request.status !== "COMPLETED") {
        throw new Error(`command request ${commandRequestId} ended with ${request.status}`);
      }
      return `command request ${commandRequestId} completed`;
    }
    const now = Date.now();
    // C4: keep durable playbook job lease alive during long SSH waits.
    if (onProgress && now - lastHeartbeat >= 15_000) {
      lastHeartbeat = now;
      await onProgress(`waiting command ${commandRequestId} (${request.status})`);
    }
    await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_MS));
  }
  throw new Error(`command request ${commandRequestId} timed out after ${timeoutSec}s`);
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
  if (COMMAND_TERMINAL.has(request.status)) return undefined;
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
            `notification recipient outside team scope: ${step.config.recipientUserId}`,
          );
        }
      }
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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, step.timeoutSec) * 1_000);
      try {
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
          async () => {
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
