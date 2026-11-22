import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const failureText = "Webhook delivery failed";
const progressText = "Playbook step progress";
const hasUrl = /https?:\/\//i;

/** Safe to apply before list or export serialization while older workers are still running. */
export function projectPlaybookAuditEntry<T extends { action: string; detail: Prisma.JsonValue }>(row: T): T {
  const detail = row.detail;
  if (row.action !== "playbook.run.failed" || !detail || typeof detail !== "object" || Array.isArray(detail)
    || typeof detail.failedError !== "string" || !hasUrl.test(detail.failedError)) return row;
  return { ...row, detail: { ...detail, failedError: failureText } };
}

export function projectPlaybookJobMessage(jobType: string, eventType: string, message: string) {
  return jobType === "playbook.run" && eventType === "heartbeat" && hasUrl.test(message) ? progressText : message;
}

/** Older workers stored the webhook request URL in failedError and used unfiltered step names as heartbeat text. */
export async function redactLegacyPlaybookMessages() {
  // Each statement commits independently. A restart can safely repeat the scrub.
  await prisma.$executeRaw`UPDATE audit_logs SET detail = jsonb_set(detail, '{failedError}', to_jsonb(${failureText}::text))
    WHERE action = 'playbook.run.failed' AND detail->>'failedError' ~* 'https?://'`;
  await prisma.$executeRaw`UPDATE job_events e SET message = ${progressText}
    FROM jobs j WHERE e."jobId" = j.id AND j.type = 'playbook.run' AND e.type = 'heartbeat' AND e.message ~* 'https?://'`;
  await prisma.$executeRaw`UPDATE jobs SET progress = ${progressText}
    WHERE type = 'playbook.run' AND progress ~* 'https?://'`;
  await prisma.$executeRaw`UPDATE playbook_runs SET "errorMessage" = ${failureText}
    WHERE status = 'failed' AND "errorMessage" ~* 'webhook.*https?://'`;
}
