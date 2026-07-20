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
import { BusinessError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import type { SessionPayload } from "@/lib/auth/session";

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
import { t } from "@/lib/i18n/translations";

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

export async function runBackupRecord(input: { type: "DATABASE" | "FILES" | "FULL"; createdBy?: string | null; note?: string; projectRoot?: string; teamId?: string | null }) {
	const record = await createBackupRecord(input);
	return runExistingBackupRecord({ id: record.id, projectRoot: input.projectRoot });
}

export async function runExistingBackupRecord(input: { id: string; projectRoot?: string; session?: Pick<import("@/lib/auth/session").SessionPayload, "userId" | "roles" | "currentTeamId"> }) {
	const projectRoot = input.projectRoot || config.app.appDir || process.cwd();
	const record = await getBackupRecord(input.id, input.session);
	if (!record) throw new NotFoundError(t("backend.backup.recordNotFound"));
	if (!isBackupType(record.type)) throw new ValidationError(t("backend.backup.invalidType"));
	let outputPath: string;
	try {
		outputPath = resolveBackupPath(projectRoot, record.filePath);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Invalid backup path";
		return updateBackupRecordStatus(record.id, { status: "FAILED", errorMessage: message.slice(0, 2000) });
	}
	const args = record.type === "FILES" ? ["--files", outputPath] : record.type === "FULL" ? ["--full", outputPath] : [outputPath];

	// CAS claim: only one worker can move PENDING → RUNNING.
	const claimed = await prisma.backupRecord.updateMany({
		where: { id: record.id, status: "PENDING" },
		data: { status: "RUNNING", errorMessage: null },
	});
	if (claimed.count === 0) {
		const latest = await getBackupRecord(record.id);
		if (latest?.status === "RUNNING") {
			throw new ConflictError(t("backend.backup.backupIsAlreadyRunning"));
		}
		if (latest?.status === "COMPLETED") {
			return latest;
		}
		throw new ConflictError(`Backup cannot start from status ${latest?.status ?? "unknown"}`);
	}

	try {
		await runBackupCommand({
			file: "bash",
			args: ["deploy/backup.sh", ...args],
			options: { cwd: projectRoot, env: { ...process.env, APP_DIR: projectRoot } },
		});
		const fileInfo = await stat(outputPath);
		// Align with VPS empty-archive guard: tiny/empty artifacts are false success.
		const MIN_LOCAL_BACKUP_BYTES = 32;
		if (!Number.isFinite(fileInfo.size) || fileInfo.size < MIN_LOCAL_BACKUP_BYTES) {
			throw new BusinessError(
				`Backup artifact is empty or too small (${fileInfo.size} bytes); treating as failed`,
			);
		}
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

function buildRestoreExecution(record: { type: string; filePath: string }, projectRoot: string, component: "database" | "files" | "all" = "all") {
	const backupPath = resolveBackupPath(projectRoot, record.filePath);
	const type = isBackupType(record.type) ? record.type : "DATABASE";

	// FEAT-P1: 细粒度恢复 — 根据 component 选择恢复范围.
	// Prefer argv arrays (execFile) over bash -c string interpolation so paths
	// never re-enter a shell parser even when already path-validated.
	if (type === "DATABASE") {
		return {
			steps: [{ file: "bash", args: ["scripts/restore-db.sh", backupPath] }],
			backupPath,
		};
	}
	if (type === "FILES") {
		return {
			steps: [{ file: "tar", args: ["-xzf", backupPath, "-C", projectRoot] }],
			backupPath,
		};
	}
	// FULL backup: component controls what to restore
	if (type === "FULL") {
		if (component === "database") {
			return {
				steps: [{ file: "bash", args: ["scripts/restore-db.sh", backupPath] }],
				backupPath,
			};
		}
		if (component === "files") {
			return {
				steps: [{ file: "tar", args: ["-xzf", backupPath, "-C", projectRoot] }],
				backupPath,
			};
		}
		// all: restore DB first, then files — sequential execFile steps (no bash -c)
		return {
			steps: [
				{ file: "bash", args: ["scripts/restore-db.sh", backupPath] },
				{ file: "tar", args: ["-xzf", backupPath, "-C", projectRoot] },
			],
			backupPath,
		};
	}
	return {
		steps: [{ file: "bash", args: ["scripts/restore-db.sh", backupPath] }],
		backupPath,
	};
}

export async function restoreBackupRecord(input: { id: string; confirm: string; projectRoot?: string; component?: "database" | "files" | "all"; session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> }) {
	if (input.confirm !== "RESTORE") {
		throw new ValidationError(t("backend.backup.restoreConfirmRequired"));
	}
	const releaseLock = await acquireAdvisoryLock("backup-restore", input.id);
	try {
		const record = await getBackupRecord(input.id, input.session);
		if (!record) {
			throw new NotFoundError(t("backend.backup.recordNotFound"));
		}
		if (record.status !== "COMPLETED") {
			throw new BusinessError(t("backend.backup.onlyCompletedCanRestore"));
		}
		const projectRoot = input.projectRoot || config.app.appDir || process.cwd();
		const execution = buildRestoreExecution(record, projectRoot, input.component ?? "all");
		await stat(execution.backupPath);
		if (!record.checksumSha256) {
			throw new BusinessError(t("backend.backup.checksumMissing"));
		}
		const actualChecksum = await calculateFileSha256(execution.backupPath);
		if (actualChecksum !== record.checksumSha256) {
			throw new BusinessError(t("backend.backup.checksumMismatch"));
		}
		for (const step of execution.steps) {
			await runBackupCommand({
				file: step.file,
				args: step.args,
				options: { cwd: projectRoot, env: { ...process.env, APP_DIR: projectRoot, CONFIRM_RESTORE: "1" } },
			});
		}
		return { id: record.id, type: record.type, filePath: record.filePath, restoredAt: new Date().toISOString() };
	} finally {
		await releaseLock();
	}
}

export type BackupDrillReport = {
	id: string;
	type: string;
	filePath: string;
	fileSize: number;
	checksum: { expected: string; actual: string; matched: boolean };
	checks: Array<{ name: string; status: "passed" | "failed"; detail: string }>;
	startedAt: string;
	completedAt: string;
	durationMs: number;
	safe: true;
};

/** Non-destructive restore drill: validates the restore artifact without changing data. */
export async function drillBackupRecord(input: { id: string; projectRoot?: string; session?: Pick<import("@/lib/auth/session").SessionPayload, "userId" | "roles" | "currentTeamId"> }): Promise<BackupDrillReport> {
	const started = new Date();
	const record = await getBackupRecord(input.id, input.session);
	if (!record) throw new NotFoundError(t("backend.backup.recordNotFound"));
	if (record.status !== "COMPLETED") throw new BusinessError(t("backend.backup.onlyCompletedCanDrill"));
	if (!record.checksumSha256) throw new BusinessError(t("backend.backup.checksumMissingDrill"));
	if (!isBackupType(record.type)) throw new ValidationError(t("backend.backup.invalidType"));
	const projectRoot = input.projectRoot || config.app.appDir || process.cwd();
	const backupPath = resolveBackupPath(projectRoot, record.filePath);
	const info = await stat(backupPath);
	if (!info.isFile() || info.size <= 0) throw new BusinessError(t("backend.backup.artifactEmpty"));
	const actualChecksum = await calculateFileSha256(backupPath);
	if (actualChecksum !== record.checksumSha256) throw new BusinessError(t("backend.backup.checksumMismatch"));
	const checks: BackupDrillReport["checks"] = [
		{ name: "artifact", status: "passed", detail: `Readable regular file (${info.size} bytes)` },
		{ name: "sha256", status: "passed", detail: actualChecksum },
	];
	await runBackupCommand({ file: "gzip", args: ["-t", backupPath], options: { cwd: projectRoot, timeout: 5 * 60 * 1000 } });
	checks.push({ name: "gzip", status: "passed", detail: "Compressed stream integrity verified" });
	if (record.type === "DATABASE") {
		const probe = await runBackupCommand({ file: "bash", args: ["-c", "set -o pipefail; gzip -cd -- \"$1\" | head -c 8192", "backup-drill", backupPath], options: { cwd: projectRoot, timeout: 5 * 60 * 1000, maxBuffer: 16 * 1024 } });
		if (!/PostgreSQL|SET |CREATE |DROP |COPY /i.test(probe.stdout)) throw new BusinessError(t("backend.backup.drillNotPostgres"));
		checks.push({ name: "database-format", status: "passed", detail: "PostgreSQL SQL stream detected" });
	} else {
		// Use execFile argv (no shell). Do NOT put `--` between -f and the archive:
		// GNU tar treats the next token after -f as the archive name, so
		// `tar -tzf -- "$path"` opens an archive literally named `--`.
		// Path is already constrained by resolveBackupPath (portable under backups/).
		await runBackupCommand({ file: "tar", args: ["-tzf", backupPath], options: { cwd: projectRoot, timeout: 10 * 60 * 1000 } });
		checks.push({ name: "archive-index", status: "passed", detail: "tar archive index parsed without extraction" });
	}
	const completed = new Date();
	return { id: record.id, type: record.type, filePath: record.filePath, fileSize: info.size, checksum: { expected: record.checksumSha256, actual: actualChecksum, matched: true }, checks, startedAt: started.toISOString(), completedAt: completed.toISOString(), durationMs: completed.getTime() - started.getTime(), safe: true };
}

export async function getBackupPolicySummary(session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">) {
	const records = await listBackupRecords(session);
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
	teamId?: string | null;
} = {}): Promise<PruneOldBackupRecordsResult> {
	const projectRoot = input.projectRoot || config.app.appDir || process.cwd();
	// Fail closed: without an explicit teamId, never list/delete all tenants'
	// backups (listBackupRecords() with no session uses where:{}).
	const teamId = typeof input.teamId === "string" && input.teamId.trim() ? input.teamId.trim() : null;
	if (!teamId) {
		retentionLogger.warn("backup retention skipped: teamId required to avoid cross-tenant prune", {
			hasTeamId: Boolean(input.teamId),
		});
		const olderThanDays = input.olderThanDays ?? 30;
		const keepLatestPerType = input.keepLatestPerType ?? 3;
		return {
			deletedRecords: 0,
			filesDeleted: 0,
			filesSkipped: 0,
			fileErrors: ["teamId required for backup retention"],
			cutoff: new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000),
			olderThanDays,
			keepLatestPerType,
			candidateIds: [],
			oldestKeptByType: {},
		};
	}
	// Prefer candidates likely to be pruned: completed/failed older than cutoff, larger page.
	const olderThanDays = input.olderThanDays ?? 30;
	const cutoffForQuery = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
	const records = await prisma.backupRecord.findMany({
		where: {
			teamId,
			OR: [
				{ status: { in: ["COMPLETED", "FAILED", "VOIDED"] }, createdAt: { lt: cutoffForQuery } },
				// still load recent completed so keepLatestPerType can protect newest
				{ status: "COMPLETED" },
			],
		},
		orderBy: { createdAt: "desc" },
		take: 2000,
	});
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
