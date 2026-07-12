/**
 * Backup service — prisma CRUD + lifecycle (R28 god-file split).
 *
 * `createBackupRecord` / `listBackupRecords` / `getBackupRecord` /
 * `updateBackupRecordStatus` are thin prisma wrappers; `voidBackupRecord`
 * and `prepareBackupRecordRetry` are the user-facing lifecycle transitions
 * (mark-as-void, queue-for-retry) that compose the CRUD primitives.
 */
import { prisma } from "@/lib/db";
import { BusinessError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import {
	assertPortableBackupPath,
	buildBackupFilePath,
	isBackupType,
} from "./service-types";
import { RESTORE_CONFIRM_TEXT } from "./service-types";

type BackupStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";

export async function createBackupRecord(input: { type: "DATABASE" | "FILES" | "FULL"; createdBy?: string; note?: string }) {
	return prisma.backupRecord.create({
		data: {
			type: input.type,
			status: "PENDING",
			filePath: buildBackupFilePath(input.type),
			createdBy: input.createdBy,
			note: input.note?.trim() || undefined,
		},
	});
}

export async function listBackupRecords() {
	return prisma.backupRecord.findMany({
		orderBy: { createdAt: "desc" },
		take: 200,
		include: { creator: { select: { username: true, displayName: true } } },
	});
}

export async function getBackupRecord(id: string) {
	return prisma.backupRecord.findUnique({ where: { id } });
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

export async function voidBackupRecord(input: { id: string; reason: string }) {
	const record = await getBackupRecord(input.id);
	if (!record) throw new NotFoundError("Backup record not found");
	if (record.status === "COMPLETED") throw new BusinessError("Completed backups cannot be voided");
	if (record.status === "RUNNING") throw new BusinessError("Running backups cannot be voided");
	const reason = input.reason.trim().slice(0, 500);
	if (!reason) throw new ValidationError("Void reason cannot be empty");
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
		throw new ConflictError("Backup status changed concurrently; cannot void");
	}
	const updated = await getBackupRecord(record.id);
	if (!updated) throw new NotFoundError("Backup record not found");
	return updated;
}

export async function prepareBackupRecordRetry(input: { id: string }) {
	const record = await getBackupRecord(input.id);
	if (!record) throw new NotFoundError("Backup record not found");
	if (record.status === "COMPLETED") throw new BusinessError("Completed backups cannot be retried");
	if (record.status === "RUNNING") throw new BusinessError("Running backups cannot be retried");
	if (record.status === "PENDING") throw new BusinessError("Pending backups cannot be re-queued");
	if (record.status !== "FAILED") throw new BusinessError("Only failed backups can be retried");
	if (!isBackupType(record.type)) throw new ValidationError("Invalid backup type");
	assertPortableBackupPath(record.filePath);
	// CAS: only re-queue while still FAILED.
	const claimed = await prisma.backupRecord.updateMany({
		where: { id: record.id, status: "FAILED" },
		data: { status: "PENDING", errorMessage: null },
	});
	if (claimed.count === 0) {
		throw new ConflictError("Backup status changed concurrently; cannot retry");
	}
	const updated = await getBackupRecord(record.id);
	if (!updated) throw new NotFoundError("Backup record not found");
	return updated;
}

/** Re-exported for callers that import the constant from `./service`. */
export { RESTORE_CONFIRM_TEXT };
