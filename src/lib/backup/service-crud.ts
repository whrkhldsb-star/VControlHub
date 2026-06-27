/**
 * Backup service — prisma CRUD + lifecycle (R28 god-file split).
 *
 * `createBackupRecord` / `listBackupRecords` / `getBackupRecord` /
 * `updateBackupRecordStatus` are thin prisma wrappers; `voidBackupRecord`
 * and `prepareBackupRecordRetry` are the user-facing lifecycle transitions
 * (mark-as-void, queue-for-retry) that compose the CRUD primitives.
 */
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
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
	if (!record) throw new NotFoundError("备份记录不存在");
	if (record.status === "COMPLETED") throw new BusinessError("已完成备份不能作废");
	if (record.status === "RUNNING") throw new BusinessError("运行中的备份不能作废");
	const reason = input.reason.trim().slice(0, 500);
	if (!reason) throw new ValidationError("作废原因不能为空");
	const prefix = "已作废";
	const errorMessage = record.errorMessage?.includes(prefix)
		? record.errorMessage
		: `${prefix}：${reason}`;
	return updateBackupRecordStatus(record.id, { status: "FAILED", errorMessage });
}

export async function prepareBackupRecordRetry(input: { id: string }) {
	const record = await getBackupRecord(input.id);
	if (!record) throw new NotFoundError("备份记录不存在");
	if (record.status === "COMPLETED") throw new BusinessError("已完成备份不能重试");
	if (record.status === "RUNNING") throw new BusinessError("运行中的备份不能重试");
	if (record.status === "PENDING") throw new BusinessError("排队中的备份不能重复排队");
	if (record.status !== "FAILED") throw new BusinessError("只能重试失败的备份记录");
	if (!isBackupType(record.type)) throw new ValidationError("备份类型无效");
	assertPortableBackupPath(record.filePath);
	return updateBackupRecordStatus(record.id, { status: "PENDING", errorMessage: null });
}

/** Re-exported for callers that import the constant from `./service`. */
export { RESTORE_CONFIRM_TEXT };
