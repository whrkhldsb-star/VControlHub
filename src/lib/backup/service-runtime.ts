/**
 * Backup service — execution / orchestration layer (R28 god-file split).
 *
 * `runBackupRecord` and `restoreBackupRecord` drive the actual backup
 * and restore operations: they call CRUD + commands + command-runner
 * and update the record's status / log as the work progresses.
 *
 * `getBackupPolicySummary` is a thin aggregate over `listBackupRecords`
 * + the pure `summarizeBackupPolicy` reducer.
 */
import { stat } from "node:fs/promises";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";

import { backupCommandErrorMessage, runBackupCommand } from "./command-runner";
import {
	isBackupType,
	resolveBackupPath,
} from "./service-types";
import {
	createBackupRecord,
	getBackupRecord,
	listBackupRecords,
	updateBackupRecordStatus,
} from "./service-crud";
import { summarizeBackupPolicy } from "./service-policy";

export async function runBackupRecord(input: { type: "DATABASE" | "FILES" | "FULL"; createdBy?: string; note?: string; projectRoot?: string }) {
	const record = await createBackupRecord(input);
	return runExistingBackupRecord({ id: record.id, projectRoot: input.projectRoot });
}

export async function runExistingBackupRecord(input: { id: string; projectRoot?: string }) {
	const projectRoot = input.projectRoot || config.app.appDir || process.cwd();
	const record = await getBackupRecord(input.id);
	if (!record) throw new NotFoundError("备份记录不存在");
	if (!isBackupType(record.type)) throw new ValidationError("备份类型无效");
	let outputPath: string;
	try {
		outputPath = resolveBackupPath(projectRoot, record.filePath);
	} catch (error) {
		const message = error instanceof Error ? error.message : "备份路径无效";
		return updateBackupRecordStatus(record.id, { status: "FAILED", errorMessage: message.slice(0, 2000) });
	}
	const args = record.type === "FILES" ? ["--files", outputPath] : record.type === "FULL" ? ["--full", outputPath] : [outputPath];

	await updateBackupRecordStatus(record.id, { status: "RUNNING" });

	try {
		await runBackupCommand({
			file: "bash",
			args: ["deploy/backup.sh", ...args],
			options: { cwd: projectRoot, env: { ...process.env, APP_DIR: projectRoot } },
		});
		const fileInfo = await stat(outputPath);
		return updateBackupRecordStatus(record.id, { status: "COMPLETED", fileSize: fileInfo.size, completedAt: new Date(), errorMessage: null });
	} catch (error) {
		return updateBackupRecordStatus(record.id, { status: "FAILED", errorMessage: backupCommandErrorMessage(error).slice(0, 2000) });
	}
}

function buildRestoreExecution(record: { type: string; filePath: string }, projectRoot: string) {
	const backupPath = resolveBackupPath(projectRoot, record.filePath);
	const type = isBackupType(record.type) ? record.type : "DATABASE";
	if (type === "FILES" || type === "FULL") {
		return { file: "tar", args: ["-xzf", backupPath, "-C", projectRoot], backupPath };
	}
	return { file: "bash", args: ["scripts/restore-db.sh", backupPath], backupPath };
}

export async function restoreBackupRecord(input: { id: string; confirm: string; projectRoot?: string }) {
	if (input.confirm !== "RESTORE") {
		throw new ValidationError("恢复操作需要明确确认");
	}
	const record = await getBackupRecord(input.id);
	if (!record) {
		throw new NotFoundError("备份记录不存在");
	}
	if (record.status !== "COMPLETED") {
		throw new BusinessError("只能恢复已完成的备份");
	}
	const projectRoot = input.projectRoot || config.app.appDir || process.cwd();
	const execution = buildRestoreExecution(record, projectRoot);
	await stat(execution.backupPath);
	await runBackupCommand({
		file: execution.file,
		args: execution.args,
		options: { cwd: projectRoot, env: { ...process.env, APP_DIR: projectRoot, CONFIRM_RESTORE: "1" } },
	});
	return { id: record.id, type: record.type, filePath: record.filePath, restoredAt: new Date().toISOString() };
}

export async function getBackupPolicySummary() {
	const records = await listBackupRecords();
	return summarizeBackupPolicy(records);
}
