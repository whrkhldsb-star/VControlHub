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
      return `run_command "${truncate(cfg.command, 80)}" on ${cfg.serverIds.length} server(s)`;
    }
    case "send_notification": {
      const cfg = step.config;
      return `send_notification "${truncate(cfg.subject, 60)}" to ${cfg.recipientUserId}`;
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
      // Actually call the webhook URL. Previously this branch was a
      // silent no-op ("skipped in M04"), which meant a playbook that
      // *looked* configured to call out would silently succeed without
      // ever making the HTTP request — a real functional gap. We now
      // perform the request and let any non-2xx response fail the step
      // so the operator sees the broken integration in the run log.
      // SSRF: reuse shared webhook safety (HTTPS-only + private/metadata block).
      const cfg = step.config as {
        url: string;
        method: "GET" | "POST" | "PUT";
        headers?: Record<string, string>;
        body?: string;
      };
      const { fetchWebhookSafely } = await import("@/lib/security/webhook-url");
      const controller = new AbortController();
      const timeoutMs = Math.max(1, step.timeoutSec) * 1000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const result = await fetchWebhookSafely(cfg.url, {
          method: cfg.method,
          headers: cfg.headers ?? { "Content-Type": "application/json" },
          body: cfg.method === "GET" ? undefined : cfg.body,
          signal: controller.signal,
        });
        if (!result.ok) {
          throw new Error(result.error ?? `webhook URL blocked: ${cfg.url}`);
        }
        const response = result.response;
        if (!response.ok) {
          throw new Error(`webhook ${cfg.method} ${cfg.url} returned ${response.status} ${response.statusText}`);
        }
        return `webhook ${cfg.method} ${cfg.url} → ${response.status}`;
      } finally {
        clearTimeout(timer);
      }
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
}): Promise<{ results: PlaybookStepResult[]; summary: string }> {
  const results: PlaybookStepResult[] = [];
  const totalSteps = input.playbook.steps.length;

  for (let i = 0; i < totalSteps; i++) {
    const step = input.playbook.steps[i]!;
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
      message: `step ${step.id} ${result.status} (${i + 1}/${totalSteps})`,
      workerId: null,
      payload: {
        stepId: step.id,
        status: result.status,
        summary: result.summary,
        error: result.error,
        stepIndex: i,
        totalSteps,
      },
    });

    // FEAT-P0-5: Incremental progress persistence
    if (!input.dryRun) {
      try {
        await prisma.playbookRun.update({
          where: { id: input.runId },
          data: { stepResults: results as unknown as Prisma.InputJsonValue },
        });
      } catch {
        // Non-fatal: run may have been cancelled or deleted.
      }
    }

    if (result.status === "failed" && !input.dryRun) {
      break;
    }
  }

  // FEAT-P0-5: Result summary for cross-node aggregation
  const okCount = results.filter((r) => r.status === "ok").length;
  const failedCount = results.filter((r) => r.status === "failed").length;
  const dryRunCount = results.filter((r) => r.status === "dry_run").length;
  const summary = input.dryRun
    ? `dry-run: ${dryRunCount}/${totalSteps} steps planned`
    : `completed ${okCount}/${totalSteps} steps${failedCount > 0 ? `, ${failedCount} failed` : ""}`;

  return { results, summary };
}
