import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Backup service — prisma CRUD + lifecycle (R28 god-file split).
 *
 * `createBackupRecord` / `listBackupRecords` / `getBackupRecord` /
 * `updateBackupRecordStatus` are thin prisma wrappers; `voidBackupRecord`
 * and `prepareBackupRecordRetry` are the user-facing lifecycle transitions
 * (mark-as-void, queue-for-retry) that compose the CRUD primitives.
 */
import { Prisma } from "@prisma/client";
import { failStaleBackupRecords } from "./stale-records";
import { prisma } from "@/lib/db";
import { teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { BusinessError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
	assertPortableBackupPath,
	BACKUP_CREATE_JOB_TYPE,
	buildBackupFilePath,
	isBackupType,
} from "./service-types";
import { t } from "@/lib/i18n/service-translations";
import { config } from "@/lib/config/env";

type BackupStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export async function createBackupRecord(
	input: { type: "DATABASE" | "FILES" | "FULL"; createdBy?: string | null; note?: string; teamId?: string | null; scheduleId?: string | null },
	client: Pick<typeof prisma, "backupRecord"> = prisma,
) {
	return client.backupRecord.create({
		data: {
			type: input.type,
			status: "PENDING",
			filePath: buildBackupFilePath(input.type),
			createdBy: input.createdBy ?? null,
			teamId: input.teamId ?? null,
			scheduleId: input.scheduleId ?? null,
			note: input.note?.trim() || undefined,
		},
	});
}

/** Platform backups contain every customer. Only a current platform administrator can create one. */
export async function canCreatePlatformBackup(userId: string, client: Pick<typeof prisma, "user"> = prisma) {
	return (await client.user.count({
		where: {
			id: userId, status: "ACTIVE", mustChangePassword: false, teamMembership: null,
			roles: { some: { role: { key: "admin" } } },
		},
	})) === 1;
}

const foldBackupPathCase = process.platform === "win32" || process.platform === "darwin";

/** Match the surrounding whitespace stripped by assertPortableBackupPath, also
 * folding case on hosts that commonly use case-insensitive filesystems. */
export function backupArtifactKey(filePath: string) {
	const portable = assertPortableBackupPath(filePath);
	return foldBackupPathCase ? portable.toLowerCase() : portable;
}

export async function hasBackupArtifactReference(tx: Prisma.TransactionClient, artifactKey: string) {
	// PostgreSQL btrim defaults to ASCII space. Supply the ECMAScript trim characters.
	const whitespace = " \t\n\r\v\f\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff";
	const trimmed = Prisma.sql`btrim("filePath", ${whitespace})`;
	const path = foldBackupPathCase ? Prisma.sql`lower(${trimmed})` : trimmed;
	const [row] = await tx.$queryRaw<{ used: boolean }[]>`
		SELECT EXISTS (SELECT FROM backup_records WHERE ${path} = ${artifactKey}) AS used
	`;
	return row!.used;
}

export async function listBackupRecords(session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">, take = 500) {
	return prisma.backupRecord.findMany({
		where: session ? teamWhere(session) : {},
		orderBy: { createdAt: "desc" },
		take,
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
	// Use VOIDED (not FAILED) so voided rows cannot be retried as ordinary failures.
	const claimed = await prisma.backupRecord.updateMany({
		where: {
			id: record.id,
			status: { in: ["PENDING", "FAILED"] },
		},
		data: { status: "VOIDED", errorMessage },
	});
	if (claimed.count === 0) {
		throw new ConflictError(t("backend.backup.backupStatusChangedConcurrentlyCannotVoid"));
	}
	const updated = await getBackupRecord(record.id, input.session);
	if (!updated) throw new NotFoundError(t("backend.backup.recordNotFound"));
	return updated;
}

export async function prepareBackupRecordRetry(input: { id: string; session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> }) {
	const record = await getBackupRecord(input.id, input.session);
	if (!record) throw new NotFoundError(t("backend.backup.recordNotFound"));
	if (record.status === "COMPLETED") throw new BusinessError(t("backend.backup.cannotRetryCompleted"));
	if (record.status === "RUNNING") throw new BusinessError(t("backend.backup.cannotRetryRunning"));
	if (record.status === "PENDING") throw new BusinessError(t("backend.backup.cannotRequeuePending"));
	if (record.status === "VOIDED") throw new BusinessError(t("backend.backup.cannotRetryVoided"));
	if (record.status !== "FAILED") throw new BusinessError(t("backend.backup.onlyFailedCanRetry"));
	if (!isBackupType(record.type)) throw new ValidationError(t("backend.backup.invalidType"));
	assertPortableBackupPath(record.filePath);
	// CAS: only re-queue while still FAILED.
	const claimed = await prisma.backupRecord.updateMany({
		where: { id: record.id, status: "FAILED", updatedAt: record.updatedAt },
		data: { status: "PENDING", errorMessage: null },
	});
	if (claimed.count === 0) {
		throw new ConflictError(t("backend.backup.backupStatusChangedConcurrentlyCannotRetry"));
	}
	const updated = await getBackupRecord(record.id, input.session);
	if (!updated) throw new NotFoundError(t("backend.backup.recordNotFound"));
	return updated;
}

/**
 * Mark orphaned PENDING backups as VOIDED so they stop looking "stuck forever".
 * Records older than `olderThanMs` still PENDING are CAS-updated to VOIDED in place
 * (non-retryable; use a new record to re-run). Default olderThanMs: 24h.
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
	// Filter jobs before LIMIT so that a backlog cannot hide older orphans.
	// Lock the selected records in the same statement that voids them.
	const message = apiCopy("apiCopy.voided.991e85c4", { v0: reason });
	const rows = await prisma.$queryRaw<{ id: string }[]>`
		WITH orphans AS (
			SELECT b.id, b."updatedAt" FROM backup_records b
			WHERE b.status = 'PENDING' AND b."updatedAt" < ${cutoff}
			  AND NOT EXISTS (
				SELECT 1 FROM jobs j WHERE j.type = ${BACKUP_CREATE_JOB_TYPE}
				  AND j.status IN ('PENDING', 'RUNNING') AND j.payload->>'backupId' = b.id
			  )
			ORDER BY b."updatedAt", b.id
			LIMIT ${limit} FOR NO KEY UPDATE OF b SKIP LOCKED
		), voided AS (
			UPDATE backup_records b
			SET status = 'VOIDED', "errorMessage" = ${message}, "updatedAt" = ${new Date()}
			FROM orphans WHERE b.id = orphans.id
			RETURNING b.id
		)
		SELECT voided.id FROM voided JOIN orphans USING (id)
		ORDER BY orphans."updatedAt", orphans.id
	`;
	return { abandoned: rows.length, ids: rows.map((row) => row.id) };
}

/**
 * Reap LOCAL backups stuck RUNNING because their worker died mid-run
 * (OOM/SIGKILL/redeploy) so the in-proc catch never marked them FAILED.
 *
 * Mirror of abandonStaleRunningVpsBackupRecords. recoverStaleRunningJobs only
 * finalizes the durable Job row, not this BackupRecord, and the PENDING sweep
 * above never touches RUNNING. Without this a crashed backup is stranded
 * RUNNING forever — invisible as a failure and impossible to clear:
 * voidBackupRecord and prepareBackupRecordRetry both refuse RUNNING rows.
 *
 * Terminal state is FAILED (not VOIDED): the backup genuinely started, so the
 * user should be able to retry it like any other failure.
 */
export async function abandonStaleRunningBackupRecords(input?: {
	olderThanMs?: number;
	reason?: string;
	limit?: number;
}) {
	const olderThanMs = input?.olderThanMs ?? config.backup.staleRunningAfterMs;
	const reason = (input?.reason ?? "Stale RUNNING backup abandoned after worker timeout").slice(0, 500);
	const limit = Math.min(Math.max(input?.limit ?? 50, 1), 200);
	const cutoff = new Date(Date.now() - olderThanMs);
	return failStaleBackupRecords("platform-running", cutoff, limit, reason);
}
