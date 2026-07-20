/**
 * Backup service — prisma CRUD + lifecycle (R28 god-file split).
 *
 * `createBackupRecord` / `listBackupRecords` / `getBackupRecord` /
 * `updateBackupRecordStatus` are thin prisma wrappers; `voidBackupRecord`
 * and `prepareBackupRecordRetry` are the user-facing lifecycle transitions
 * (mark-as-void, queue-for-retry) that compose the CRUD primitives.
 */
import { prisma } from "@/lib/db";
import { teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { BusinessError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
	assertPortableBackupPath,
	buildBackupFilePath,
	isBackupType,
} from "./service-types";
import { RESTORE_CONFIRM_TEXT } from "./service-types";
import { t } from "@/lib/i18n/translations";

type BackupStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export async function createBackupRecord(input: { type: "DATABASE" | "FILES" | "FULL"; createdBy?: string | null; note?: string; teamId?: string | null }) {
	return prisma.backupRecord.create({
		data: {
			type: input.type,
			status: "PENDING",
			filePath: buildBackupFilePath(input.type),
			createdBy: input.createdBy ?? null,
			teamId: input.teamId ?? null,
			note: input.note?.trim() || undefined,
		},
	});
}

export async function listBackupRecords(session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">) {
	return prisma.backupRecord.findMany({
		where: session ? teamWhere(session) : {},
		orderBy: { createdAt: "desc" },
		take: 200,
		include: { creator: { select: { username: true, displayName: true } } },
	});
}

export async function getBackupRecord(id: string, session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">) {
	return session
		? prisma.backupRecord.findFirst({ where: { id, ...teamWhere(session) } })
		: prisma.backupRecord.findUnique({ where: { id } });
}

export async function updateBackupRecordStatus(
	id: string,
	input: { status: BackupStatus; fileSize?: number; completedAt?: Date; errorMessage?: string | null; checksumSha256?: string },
) {
	const data: {
		status: BackupStatus;
		fileSize?: string;
		completedAt?: Date;
		errorMessage?: string | null;
		checksumSha256?: string;
	} = { status: input.status };
	if (input.fileSize !== undefined) data.fileSize = String(input.fileSize);
	if (input.completedAt) data.completedAt = input.completedAt;
	if (input.errorMessage !== undefined) data.errorMessage = input.errorMessage;
	if (input.checksumSha256 !== undefined) data.checksumSha256 = input.checksumSha256;
	return prisma.backupRecord.update({ where: { id }, data });
}

export async function voidBackupRecord(input: { id: string; reason: string; session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> }) {
	const record = await getBackupRecord(input.id, input.session);
	if (!record) throw new NotFoundError(t("backend.backup.recordNotFound"));
	if (record.status === "COMPLETED") throw new BusinessError(t("backend.backup.cannotVoidCompleted"));
	if (record.status === "RUNNING") throw new BusinessError(t("backend.backup.cannotVoidRunning"));
	const reason = input.reason.trim().slice(0, 500);
	if (!reason) throw new ValidationError(t("backend.backup.voidReasonRequired"));
	const prefix = "Voided";
	const errorMessage = record.errorMessage?.includes(prefix)
		? record.errorMessage
		: `${prefix}: ${reason}`;
	// CAS: only void if still in a voidable terminal/non-running state.
	const claimed = await prisma.backupRecord.updateMany({
		where: {
			id: record.id,
			status: { in: ["PENDING", "FAILED"] },
		},
		data: { status: "FAILED", errorMessage },
	});
	if (claimed.count === 0) {
		throw new ConflictError(t("backend.backup.backupStatusChangedConcurrentlyCannotVoid"));
	}
	const updated = await getBackupRecord(record.id);
	if (!updated) throw new NotFoundError(t("backend.backup.recordNotFound"));
	return updated;
}

export async function prepareBackupRecordRetry(input: { id: string; session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> }) {
	const record = await getBackupRecord(input.id, input.session);
	if (!record) throw new NotFoundError(t("backend.backup.recordNotFound"));
	if (record.status === "COMPLETED") throw new BusinessError(t("backend.backup.cannotRetryCompleted"));
	if (record.status === "RUNNING") throw new BusinessError(t("backend.backup.cannotRetryRunning"));
	if (record.status === "PENDING") throw new BusinessError(t("backend.backup.cannotRequeuePending"));
	if (record.status !== "FAILED") throw new BusinessError(t("backend.backup.onlyFailedCanRetry"));
	if (!isBackupType(record.type)) throw new ValidationError(t("backend.backup.invalidType"));
	assertPortableBackupPath(record.filePath);
	// CAS: only re-queue while still FAILED.
	const claimed = await prisma.backupRecord.updateMany({
		where: { id: record.id, status: "FAILED" },
		data: { status: "PENDING", errorMessage: null },
	});
	if (claimed.count === 0) {
		throw new ConflictError(t("backend.backup.backupStatusChangedConcurrentlyCannotRetry"));
	}
	const updated = await getBackupRecord(record.id);
	if (!updated) throw new NotFoundError(t("backend.backup.recordNotFound"));
	return updated;
}

/**
 * Mark orphaned PENDING backups as FAILED so they stop looking "stuck forever".
 * Records older than `olderThanMs` with no RUNNING claim are voided in place.
 * Default: 24h.
 */
export async function abandonStalePendingBackupRecords(input?: {
	olderThanMs?: number;
	reason?: string;
	limit?: number;
}) {
	const olderThanMs = input?.olderThanMs ?? 24 * 60 * 60 * 1000;
	const reason = (input?.reason ?? "Stale PENDING backup abandoned after timeout").slice(0, 500);
	const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
	const cutoff = new Date(Date.now() - olderThanMs);
	const stale = await prisma.backupRecord.findMany({
		where: { status: "PENDING", createdAt: { lt: cutoff } },
		select: { id: true },
		orderBy: { createdAt: "asc" },
		take: limit,
	});
	if (stale.length === 0) return { abandoned: 0, ids: [] as string[] };

	const ids: string[] = [];
	for (const row of stale) {
		const claimed = await prisma.backupRecord.updateMany({
			where: { id: row.id, status: "PENDING" },
			data: {
				status: "FAILED",
				errorMessage: `Voided: ${reason}`,
			},
		});
		if (claimed.count > 0) ids.push(row.id);
	}
	return { abandoned: ids.length, ids };
}

/** Re-exported for callers that import the constant from `./service`. */
export { RESTORE_CONFIRM_TEXT };
