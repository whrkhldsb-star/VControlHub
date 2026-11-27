import { JobStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { isSecretEnvKey } from "@/lib/quick-service/install-notice";

const TERMINAL_JOB_STATUSES: ReadonlyArray<JobStatus> = [
	JobStatus.COMPLETED,
	JobStatus.FAILED,
	JobStatus.CANCELLED,
];

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isTerminalStatus(status: JobStatus): boolean {
	return status === JobStatus.COMPLETED || status === JobStatus.FAILED || status === JobStatus.CANCELLED;
}

export function redactQuickServiceJobPayload(
	rawPayload: unknown,
): { changed: boolean; payload: Prisma.InputJsonValue } | null {
	if (!isRecord(rawPayload)) return null;
	const payload = { ...rawPayload } as Record<string, unknown>;
	let changed = false;
	if ("installNoticeCredentials" in payload) {
		delete payload.installNoticeCredentials;
		changed = true;
	}
	if (isRecord(payload.template)) {
		const template = { ...payload.template } as Record<string, unknown>;
		if (isRecord(template.envJson)) {
			const envJson = { ...(template.envJson as Record<string, unknown>) };
			for (const key of Object.keys(envJson)) {
				if (isSecretEnvKey(key) && envJson[key] !== "[redacted]") {
					envJson[key] = "[redacted]";
					changed = true;
				}
			}
			template.envJson = envJson;
		}
		if (typeof template.initialPassword === "string" && template.initialPassword !== "[redacted]") {
			template.initialPassword = "[redacted]";
			changed = true;
		}
		payload.template = template;
	}
	return { changed, payload: payload as Prisma.InputJsonValue };
}

/**
 * Redact install secrets from a QuickService durable `Job.payload` once the
 * job has reached a terminal state (COMPLETED, FAILED, CANCELLED). Never scrubs
 * PENDING (requeued retries still need their install credentials) or RUNNING.
 *
 * Propagates database write errors so callers executing inside a terminal
 * transition transaction roll back instead of committing plaintext secrets.
 */
export async function scrubQuickServiceJobPayloadSecrets(
	jobId: string,
	db: Pick<Prisma.TransactionClient, "job"> = prisma,
): Promise<boolean> {
	if (typeof db.job?.findUnique !== "function") return false;
	const job = await db.job.findUnique({
		where: { id: jobId },
		select: { type: true, payload: true, status: true },
	});
	if (!job || job.type !== "quick_service.lifecycle" || !isTerminalStatus(job.status)) {
		return false;
	}
	const redacted = redactQuickServiceJobPayload(job.payload);
	if (!redacted?.changed) return false;
	const updated = await db.job.updateMany({
		where: { id: jobId, status: { in: [...TERMINAL_JOB_STATUSES] } },
		data: { payload: redacted.payload },
	});
	return updated.count > 0;
}
