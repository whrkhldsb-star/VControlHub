import type { PlaybookStep, PlaybookStepResult } from "./types";

/** Only these fields may travel from a webhook configuration or receipt into run history. */
export function describeWebhookStep(
  step: Extract<PlaybookStep, { type: "call_webhook" }>,
  result?: Partial<PlaybookStepResult>,
) {
  const url = typeof step.config?.url === "string" ? URL.parse(step.config.url) : null;
  const host = url?.protocol === "https:" ? url.host : "(invalid host)";
  const method = step.config?.method;
  const safeMethod = method === "GET" || method === "POST" || method === "PUT" ? method : "(invalid method)";
  const label = `webhook step ${step.id} ${safeMethod} ${host}`;
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
  if (result.status === "failed") return { ...result, summary: "", error: description };
  return {
    ...result,
    summary: result.status === "dry_run" ? `dry-run: ${description}` : description,
    ...(result.error !== undefined ? { error: description } : {}),
  };
}
