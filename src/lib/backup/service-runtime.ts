/**
 * Backup service — execution / orchestration layer (R28 god-file split).
 *
 * `runBackupRecord` and `restoreBackupRecord` drive the actual backup
 * and restore operations: they call CRUD + commands + command-runner
 * and update the record's status / log as the work progresses.
 *
 * `pruneOldBackupRecordsNow` runs the retention plan produced by
 * `pruneOldBackupRecords`, removes the underlying artifact (only for
 * portable paths under `BACKUP_DIR` / `<projectRoot>/backups`), and
 * removes the corresponding DB rows.
 *
 * `getBackupPolicySummary` is a thin aggregate over `listBackupRecords`
 * + the pure `summarizeBackupPolicy` reducer.
 */
import { rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";

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
import { pruneOldBackupRecords, summarizeBackupPolicy } from "./service-policy";
import { uploadBackupToOffsite } from "./offsite-uploader";

const offsiteUploadLogger = createLogger("backup-offsite-uploader");

async function calculateFileSha256(filePath: string): Promise<string> {
	return new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		const stream = createReadStream(filePath);
		stream.on("data", (chunk) => hash.update(chunk));
		stream.on("end", () => resolve(hash.digest("hex")));
		stream.on("error", reject);
	});
}

export async function runBackupRecord(input: { type: "DATABASE" | "FILES" | "FULL"; createdBy?: string; note?: string; projectRoot?: string }) {
	const record = await createBackupRecord(input);
	return runExistingBackupRecord({ id: record.id, projectRoot: input.projectRoot });
}

export async function runExistingBackupRecord(input: { id: string; projectRoot?: string }) {
	const projectRoot = input.projectRoot || config.app.appDir || process.cwd();
	const record = await getBackupRecord(input.id);
	if (!record) throw new NotFoundError("Backup record not found");
	if (!isBackupType(record.type)) throw new ValidationError("Invalid backup type");
	let outputPath: string;
	try {
		outputPath = resolveBackupPath(projectRoot, record.filePath);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Invalid backup path";
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
		const checksumSha256 = await calculateFileSha256(outputPath);
		const updated = await updateBackupRecordStatus(record.id, {
			status: "COMPLETED",
			fileSize: fileInfo.size,
			completedAt: new Date(),
			errorMessage: null,
			checksumSha256,
		});
		// TR-009 55a: best-effort offsite 上传 — 失败不影响 backup COMPLETED
		void uploadBackupToOffsite({ backupId: record.id, projectRoot })
			.then((result) => {
				if (result.ok === false) {
					offsiteUploadLogger.warn("offsite upload did not succeed (non-fatal)", {
						backupId: record.id,
						code: result.code,
						error: result.error,
					});
				} else if (result.skipped) {
					offsiteUploadLogger.info("offsite upload skipped", {
						backupId: record.id,
						reason: result.reason,
					});
				} else {
					offsiteUploadLogger.info("offsite upload completed", {
						backupId: record.id,
						key: result.key,
						originalSize: result.originalSize,
						compressedSize: result.compressedSize,
						ratio: result.ratio,
					});
				}
			})
			.catch((err) => {
				offsiteUploadLogger.error("offsite upload threw (non-fatal)", {
					backupId: record.id,
					error: err instanceof Error ? err.message : String(err),
				});
			});
		return updated;
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
		throw new ValidationError("Restore operation requires explicit confirmation");
	}
	const record = await getBackupRecord(input.id);
	if (!record) {
		throw new NotFoundError("Backup record not found");
	}
	if (record.status !== "COMPLETED") {
		throw new BusinessError("Only completed backups can be restored");
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

const retentionLogger = createLogger("backup-retention");

export type PruneOldBackupRecordsResult = {
	deletedRecords: number;
	filesDeleted: number;
	filesSkipped: number;
	fileErrors: string[];
	cutoff: Date;
	olderThanDays: number;
	keepLatestPerType: number;
	candidateIds: string[];
	oldestKeptByType: Record<string, Date | null>;
};

/**
 * Execute the retention plan. For each candidate:
 *   1. Resolve the file path through `resolveBackupPath` — that function
 *      rejects non-portable paths and absolute / `..` traversal, so we
 *      can only delete artifacts that are within the configured backup
 *      root. If resolution fails, the file is left in place but the DB
 *      row is still deleted (we never want an orphan DB row pointing at
 *      a path we cannot unlink).
 *   2. Best-effort `rm()` — missing files are recorded as `filesSkipped`
 *      (not errors). Real errors (e.g. EACCES) go into `fileErrors`.
 *   3. The DB row is deleted via prisma — this is the source of truth.
 *
 * Returns a small summary suitable for the durable-job completion
 * payload and the UI toast.
 */
export async function pruneOldBackupRecordsNow(input: {
	olderThanDays?: number;
	keepLatestPerType?: number;
	projectRoot?: string;
} = {}): Promise<PruneOldBackupRecordsResult> {
	const projectRoot = input.projectRoot || config.app.appDir || process.cwd();
	const records = await listBackupRecords();
	const plan = pruneOldBackupRecords(records, {
		olderThanDays: input.olderThanDays,
		keepLatestPerType: input.keepLatestPerType,
	});

	let filesDeleted = 0;
	let filesSkipped = 0;
	const fileErrors: string[] = [];
	const deletedIds: string[] = [];

	for (const candidate of plan.candidates) {
		if (candidate.filePath) {
			let fileExists = true;
			let fullPath: string | null = null;
			try {
				fullPath = resolveBackupPath(projectRoot, candidate.filePath);
			} catch (pathError) {
				const message = pathError instanceof Error ? pathError.message : String(pathError);
				fileErrors.push(`${candidate.id}: ${message.slice(0, 200)}`);
				retentionLogger.warn("backup retention: file cleanup failed", {
					backupId: candidate.id,
					filePath: candidate.filePath,
					error: message,
				});
			}
			if (fullPath) {
				try {
					await stat(fullPath);
				} catch (statError) {
					if ((statError as NodeJS.ErrnoException).code === "ENOENT") {
						fileExists = false;
					} else {
						const message = statError instanceof Error ? statError.message : String(statError);
						fileErrors.push(`${candidate.id}: ${message.slice(0, 200)}`);
						retentionLogger.warn("backup retention: stat failed", {
							backupId: candidate.id,
							filePath: fullPath,
							error: message,
						});
					}
				}
				if (fileExists) {
					try {
						await rm(fullPath, { force: true });
						filesDeleted += 1;
					} catch (rmError) {
						if ((rmError as NodeJS.ErrnoException).code === "ENOENT") {
							filesSkipped += 1;
						} else {
							const message = rmError instanceof Error ? rmError.message : String(rmError);
							fileErrors.push(`${candidate.id}: ${message.slice(0, 200)}`);
							retentionLogger.warn("backup retention: rm failed", {
								backupId: candidate.id,
								filePath: fullPath,
								error: message,
							});
						}
					}
				} else {
					filesSkipped += 1;
				}
			}
		} else {
			filesSkipped += 1;
		}

		try {
			await prisma.backupRecord.delete({ where: { id: candidate.id } });
			deletedIds.push(candidate.id);
		} catch (deleteError) {
			const message = deleteError instanceof Error ? deleteError.message : String(deleteError);
			retentionLogger.error("backup retention: DB delete failed", {
				backupId: candidate.id,
				error: message,
			});
			throw deleteError;
		}
	}

	const result: PruneOldBackupRecordsResult = {
		deletedRecords: deletedIds.length,
		filesDeleted,
		filesSkipped,
		fileErrors,
		cutoff: plan.cutoff,
		olderThanDays: plan.olderThanDays,
		keepLatestPerType: plan.keepLatestPerType,
		candidateIds: deletedIds,
		oldestKeptByType: plan.oldestKeptByType,
	};
	retentionLogger.info("backup retention: plan executed", {
		deletedRecords: result.deletedRecords,
		filesDeleted: result.filesDeleted,
		filesSkipped: result.filesSkipped,
		fileErrors: result.fileErrors.length,
		cutoff: result.cutoff.toISOString(),
	});
	return result;
}
