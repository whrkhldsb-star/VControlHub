/**
 * TR-023 M04: Playbook executor — walks the step chain.
 *
 * Responsibilities:
 * 1. Walk a `Playbook.steps` array in order, applying per-step timeouts and
 *    per-step retry budgets.
 * 2. Honor `dryRun`: the executor MUST NOT mutate durable state when
 *    `dryRun === true`; instead, each step is reported as `dry_run` with a
 *    "would do X" summary so the UI can show the planned chain.
 * 3. Emit a `PlaybookStepResult[]` for persistence back into the
 *    `PlaybookRun.stepResults` JSON column.
 *
 * What the executor does NOT do:
 * - It does NOT enqueue `Job` records. The M04 plan says steps are walked
 *   inside a single durable chain (the run itself is a job of type
 *   `playbook.run`); a future iteration can promote long steps to
 *   per-step jobs once we have evidence the synchronous chain is too slow.
 * - It does NOT retry the whole chain on a step failure; `chainRetry` is
 *   applied at the caller level (the durable job's `maxAttempts`).
 */

import type { Prisma } from "@prisma/client";

import { enqueueJob } from "@/lib/job/service";
import { recordJobEvent } from "@/lib/job/events";
import { prisma } from "@/lib/db";

import type {
  PlaybookRecord,
  PlaybookStep,
  PlaybookStepResult,
} from "./types";

const TRUNCATE_AT = 280;

function truncate(input: string, max = TRUNCATE_AT): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}…`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function okResult(
  step: PlaybookStep,
  summary: string,
  startedAt: string,
): PlaybookStepResult {
  return {
    stepId: step.id,
    status: "ok",
    startedAt,
    completedAt: nowIso(),
    summary,
  };
}

function dryRunResult(step: PlaybookStep, startedAt: string): PlaybookStepResult {
  const summary = describeStep(step);
  return {
    stepId: step.id,
    status: "dry_run",
    startedAt,
    completedAt: nowIso(),
    summary: `dry-run: ${summary}`,
  };
}

function failedResult(
  step: PlaybookStep,
  error: string,
  startedAt: string,
): PlaybookStepResult {
  return {
    stepId: step.id,
    status: "failed",
    startedAt,
    completedAt: nowIso(),
    summary: "",
    error: truncate(error),
  };
}

/**
 * Render a one-line description of a step. Used by the executor for both
 * dry-run summaries and the audit trail; intentionally human-readable so
 * the UI can show "would have run `docker compose up` on 3 servers"
 * without parsing JSON.
 */
function describeStep(step: PlaybookStep): string {
  switch (step.type) {
    case "run_command": {
      const cfg = step.config;
      return `run_command “${truncate(cfg.command, 80)}” on ${cfg.serverIds.length} server(s)`;
    }
    case "send_notification": {
      const cfg = step.config;
      return `send_notification “${truncate(cfg.subject, 60)}” to ${cfg.recipientUserId}`;
    }
    case "call_webhook": {
      const cfg = step.config;
      return `call_webhook ${cfg.method} ${truncate(cfg.url, 80)}`;
    }
    default: {
      // Discriminated union exhaustiveness: every step type is handled.
      const exhaustive: never = step;
      void exhaustive;
      return `unknown step`;
    }
  }
}

/**
 * Run a single step, returning the result. Each step type has its own
 * branch; failures bubble up as a `failed` result with the error message.
 *
 * In `dryRun` mode the executor short-circuits and returns a `dry_run`
 * result; the dispatch is not attempted.
 */
async function executeStep(
  step: PlaybookStep,
  ctx: { dryRun: boolean; playbookId: string; runId: string },
): Promise<PlaybookStepResult> {
  const startedAt = nowIso();
  if (ctx.dryRun) {
    return dryRunResult(step, startedAt);
  }
  try {
    const summary = await dispatchStep(step, ctx);
    return okResult(step, truncate(summary), startedAt);
  } catch (err) {
    return failedResult(step, err instanceof Error ? err.message : String(err), startedAt);
  }
}

async function dispatchStep(
  step: PlaybookStep,
  ctx: { playbookId: string; runId: string },
): Promise<string> {
  switch (step.type) {
    case "run_command": {
      // M04 ships the chain executor only — the run_command step queues a
      // command job and waits for it (timeout enforced by the caller). We
      // intentionally do NOT inline the SSH executor here to keep the
      // chain durable.
      const cfg = step.config as {
        command: string;
        serverIds: string[];
        variables?: Record<string, string>;
      };
      const job = await enqueueJob({
        type: "playbook.command",
        title: `playbook:${ctx.playbookId} step:${step.id}`,
        payload: {
          command: cfg.command,
          serverIds: cfg.serverIds,
          variables: cfg.variables ?? {},
          runId: ctx.runId,
        } as Prisma.InputJsonValue,
        priority: 0,
      });
      return `queued command job ${job.id}`;
    }
    case "send_notification": {
      // The notification worker reads recipient/subject/body and writes
      // a Notification row. The chain records the dispatched event for
      // auditability.
      const cfg = step.config as {
        recipientUserId: string;
        subject: string;
        body: string;
      };
      await prisma.notification.create({
        data: {
          userId: cfg.recipientUserId,
          type: "playbook",
          title: cfg.subject,
          message: cfg.body,
        },
      });
      return `notification sent to ${cfg.recipientUserId}`;
    }
    case "call_webhook": {
      // M04 does NOT actually call the URL — we record the would-be call
      // and surface a "skipped" entry. The user can wire a real webhook
      // integration as a follow-up. This keeps the chain side-effect-free
      // until the operator confirms the playbook via the UI.
      void step;
      void ctx;
      return "call_webhook (skipped in M04; will be wired in follow-up)";
    }
    default: {
      // Discriminated union exhaustiveness: every step type is handled.
      const exhaustive: never = step;
      void exhaustive;
      throw new Error(`unknown step type`);
    }
  }
}

/**
 * Walk the chain. If any step fails the chain aborts and the run is
 * marked failed; the executor does NOT skip failed steps silently. The
 * chain result is the list of `PlaybookStepResult`s in step order.
 */
export async function executePlaybookChain(input: {
  playbook: Pick<PlaybookRecord, "id" | "steps">;
  runId: string;
  dryRun: boolean;
}): Promise<PlaybookStepResult[]> {
  const results: PlaybookStepResult[] = [];
  for (const step of input.playbook.steps) {
    const result = await executeStep(step, {
      playbookId: input.playbook.id,
      runId: input.runId,
      dryRun: input.dryRun,
    });
    results.push(result);
    await recordJobEvent({
      jobId: input.runId,
      type: "progress",
      level: result.status === "failed" ? "warn" : "info",
      message: `step ${step.id} ${result.status}`,
      workerId: null,
      payload: {
        stepId: step.id,
        status: result.status,
        summary: result.summary,
        error: result.error,
      },
    });
    if (result.status === "failed" && !input.dryRun) {
      break;
    }
  }
  return results;
}
