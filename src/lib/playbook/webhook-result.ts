import { z } from "zod";
import type { PlaybookStep, PlaybookStepResult } from "./types";

type WebhookStep = Extract<PlaybookStep, { type: "call_webhook" }>;

export function projectWebhookConfig(step: WebhookStep) {
  const url = typeof step.config?.url === "string" ? URL.parse(step.config.url) : null;
  const host = url?.protocol === "https:" ? url.host : "(invalid host)";
  const method = step.config?.method;
  const safeMethod = method === "GET" || method === "POST" || method === "PUT" ? method : "(invalid method)";
  return {
    host, method: safeMethod,
    hasHeaders: Boolean(step.config?.headers && Object.keys(step.config.headers).length),
    hasBody: Boolean(step.config?.body),
    urlConfigured: Boolean(step.config?.url),
  };
}

/** Only these fields may travel from a webhook configuration or receipt into run history. */
export function describeWebhookStep(step: WebhookStep, result?: Partial<PlaybookStepResult>) {
  const { host, method } = projectWebhookConfig(step);
  const label = `webhook step ${step.id} ${method} ${host}`;
  if (result?.outcomeUnknown) return `${label}: delivery outcome unknown`;
  const status = result?.httpStatus;
  if (status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599) return `${label}: HTTP ${status}`;
  if (result?.status === "failed") {
    return result.sideEffectDispatched ? `${label}: already dispatched (at-most-once)` : `${label}: delivery failed`;
  }
  return label;
}

export function redactWebhookResult(step: PlaybookStep | undefined, result: PlaybookStepResult) {
  if (step?.type !== "call_webhook") return result;
  // Older workers wrote the full URL, including path secrets and query tokens.
  // Rebuild their text before any progress or terminal write during reclaim.
  const description = describeWebhookStep(step, result);
  const receipt = {
    stepId: result.stepId,
    status: result.status,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    ...(typeof result.httpStatus === "number" ? { httpStatus: result.httpStatus } : {}),
    ...(typeof result.outcomeUnknown === "boolean" ? { outcomeUnknown: result.outcomeUnknown } : {}),
    ...(typeof result.sideEffectDispatched === "boolean" ? { sideEffectDispatched: result.sideEffectDispatched } : {}),
  };
  if (result.status === "failed") return { ...receipt, summary: "", error: description };
  return {
    ...receipt,
    summary: result.status === "dry_run" ? `dry-run: ${description}` : description,
    ...(result.error !== undefined ? { error: description } : {}),
  };
}

// Legacy rows can contain partial receipts and arbitrary JSON. Only expose recognized
// fields; in particular a malformed timestamp must never copy transport text into the DTO.
const historyTimestamp = z.iso.datetime({ offset: true }).catch("");
const historyReceipt = z.object({
  stepId: z.string().min(1).max(64),
  status: z.enum(["running", "ok", "failed", "skipped", "dry_run"]),
  startedAt: historyTimestamp,
  completedAt: historyTimestamp,
  summary: z.string().catch(""),
  error: z.string().optional().catch(undefined),
  commandRequestId: z.string().optional().catch(undefined),
  httpStatus: z.number().int().min(100).max(599).optional().catch(undefined),
  outcomeUnknown: z.boolean().optional().catch(undefined),
  sideEffectDispatched: z.boolean().optional().catch(undefined),
});

/** Mutable playbook definitions cannot identify the step that produced an old receipt. */
export function redactRunHistory(executionState: unknown, results: unknown, errorMessage: string | null) {
  const state = executionState as { schemaVersion?: number; stepsSnapshot?: PlaybookStep[] } | null;
  const steps = state?.schemaVersion === 1 && Array.isArray(state.stepsSnapshot) ? state.stepsSnapshot : [];
  const byId = new Map(steps.filter((step) => step?.id).map((step) => [step.id, step]));
  let rebuildParentError = !Array.isArray(results) || !steps.length || steps.some((step) => step?.type === "call_webhook");
  const stepResults: PlaybookStepResult[] = [];
  for (const item of Array.isArray(results) ? results : []) {
    const receipt = historyReceipt.safeParse(item);
    if (!receipt.success) {
      rebuildParentError = true;
      continue;
    }
    const result = receipt.data;
    const step = byId.get(result.stepId);
    if (step?.type === "run_command" || step?.type === "send_notification" || step?.type === "call_webhook") {
      stepResults.push(redactWebhookResult(step, result));
    } else {
      rebuildParentError = true;
      // A pre-snapshot or orphan receipt could describe a webhook even if the current step is a command.
      stepResults.push({
        stepId: /^[\w-]+$/.test(result.stepId) ? result.stepId : `step-${stepResults.length + 1}`,
        status: result.status, startedAt: result.startedAt, completedAt: result.completedAt, summary: result.status,
        ...(result.error !== undefined ? { error: result.status } : {}),
      });
    }
  }
  if (errorMessage && rebuildParentError) {
    // Old workers copied arbitrary transport errors to the parent, sometimes before writing a step result.
    errorMessage = stepResults.find((result) => result.status === "failed")?.error ?? "failed";
  }
  return { stepResults, errorMessage };
}
