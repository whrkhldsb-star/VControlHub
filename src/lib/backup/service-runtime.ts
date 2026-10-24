import { apiCopy } from "@/lib/i18n/api-copy";
import { resolveLocalTarBinary } from "@/lib/runtime/tar-binary";
/**
 * Backup service — execution / orchestration layer (R28 god-file split).
 *
 * `runBackupRecord` drives the actual backup: it calls CRUD + commands +
 * command-runner and updates the record's status / log as the work
 * progresses. Restore is offline only: `prepareOfflineRestore` verifies the
 * artifact and returns the runbook the restore scripts then enforce.
 *
 * `pruneOldBackupRecordsNow` runs the retention plan produced by
 * `pruneOldBackupRecords`, removes the underlying artifact (only for
 * portable paths under `BACKUP_DIR` / `<projectRoot>/backups`), and
 * removes the corresponding DB rows.
 *
 * `getBackupPolicySummary` is a thin aggregate over `listBackupRecords`
 * + the pure `summarizeBackupPolicy` reducer.
 */
import { mkdtemp, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGunzip } from "node:zlib";

import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { BusinessError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { createLogger } from "@/lib/logging";
import type { SessionPayload } from "@/lib/auth/session";

import { backupCommandErrorMessage, runBackupCommand, type RunBackupCommandInput } from "./command-runner";
import { backupRunnerSpec } from "./platform-runner";
import {
	isBackupType,
	resolveBackupPath,
} from "./service-types";
import { buildBackupRestoreCommand, buildPortableBackupCommand } from "./service-commands";
import { IS_WINDOWS } from "@/lib/runtime/platform-paths";
import {
	createBackupRecord,
	getBackupRecord,
	listBackupRecords,
	updateBackupRecordStatus,
} from "./service-crud";
import { pruneOldBackupRecords, summarizeBackupPolicy } from "./service-policy";
import { uploadBackupToOffsite } from "./offsite-uploader";
import { t } from "@/lib/i18n/service-translations";

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

/**
 * Platform dispatch for invoking the backup script: bash `deploy/backup.sh` on
 * POSIX, the current Node executable running `scripts/backup.mjs` on Windows.
 */
function buildBackupInvocation(extraArgs: string[]): Pick<RunBackupCommandInput, "file" | "args"> {
	const { file, script } = backupRunnerSpec();
	return { file, args: [script, ...extraArgs] };
}

/**
 * Verify a gzip stream end-to-end via Node zlib — replaces the external
 * `gzip -t` probe so drills work wherever the app itself runs.
 */
function verifyGzipIntegrity(filePath: string, timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			stream.destroy();
			reject(new Error(`gzip integrity check timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		const stream = createReadStream(filePath);
		const gunzip = createGunzip();
		let settled = false;
		const settle = (error?: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve();
		};
		stream.on("error", settle);
		gunzip.on("error", settle);
		gunzip.on("end", () => settle());
		// Drain the decompressed bytes; only stream integrity matters here.
		gunzip.resume();
		stream.pipe(gunzip);
	});
}

/**
 * Decompress the first `maxBytes` of a gzip file — replaces the
 * `gzip -cd | head -c 8192` shell probe. The stream is then drained so the
 * file read finishes cleanly instead of dying on a broken pipe.
 */
function probeGunzipHead(filePath: string, maxBytes: number, timeoutMs: number): Promise<string> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			stream.destroy();
			reject(new Error(`gzip probe timed out after ${timeoutMs}ms`));
		}, timeoutMs);
		const stream = createReadStream(filePath);
		const gunzip = createGunzip();
		const decoder = new TextDecoder("utf-8", { fatal: false });
		const headChunks: Buffer[] = [];
		let headBytes = 0;
		let settled = false;
		const settle = (error?: Error, value?: string) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (error) reject(error);
			else resolve(value ?? "");
		};
		stream.on("error", settle);
		gunzip.on("error", settle);
		gunzip.on("data", (chunk: Buffer) => {
			if (headBytes < maxBytes) {
				headChunks.push(chunk);
				headBytes += chunk.length;
			}
		});
		gunzip.on("end", () => settle(undefined, decoder.decode(Buffer.concat(headChunks).subarray(0, maxBytes))));
		stream.pipe(gunzip);
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
			if (!latest.offsiteKey) await logOffsiteUploadResult(record.id, projectRoot);
			return latest;
		}
		throw new ConflictError(apiCopy("apiCopy.backup.cannot.start.from.status.366dbbfc", { v0: String(latest?.status ?? "unknown") }));
	}

	try {
		await runBackupCommand({
			...buildBackupInvocation(args),
			options: { cwd: projectRoot, env: { ...process.env, APP_DIR: projectRoot } },
		});
		const fileInfo = await stat(outputPath);
		// Align with VPS empty-archive guard: tiny/empty artifacts are false success.
		const MIN_LOCAL_BACKUP_BYTES = 32;
		if (!Number.isFinite(fileInfo.size) || fileInfo.size < MIN_LOCAL_BACKUP_BYTES) {
			throw new BusinessError(
				apiCopy("apiCopy.backup.artifact.is.empty.or.too.small.bytes.treating.as.failed.f5213af8", { v0: String(fileInfo.size) }),
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
		// Keep the durable backup job alive until optional offsite delivery reaches
		// a terminal result. Local completion remains valid when offsite is disabled
		// or fails, and a reclaimed completed job retries records without offsiteKey.
		await logOffsiteUploadResult(record.id, projectRoot);
		return updated;
	} catch (error) {
		return updateBackupRecordStatus(record.id, { status: "FAILED", errorMessage: backupCommandErrorMessage(error).slice(0, 2000) });
	}
}

async function logOffsiteUploadResult(backupId: string, projectRoot: string) {
	try {
		const result = await uploadBackupToOffsite({ backupId, projectRoot });
		if (result.ok === false) {
			offsiteUploadLogger.warn("offsite upload did not succeed (non-fatal)", {
				backupId,
				code: result.code,
				error: result.error,
			});
		} else if (result.skipped) {
			offsiteUploadLogger.info("offsite upload skipped", { backupId, reason: result.reason });
		} else {
			offsiteUploadLogger.info("offsite upload completed", {
				backupId,
				key: result.key,
				originalSize: result.originalSize,
				compressedSize: result.compressedSize,
				ratio: result.ratio,
			});
		}
	} catch (error) {
		offsiteUploadLogger.error("offsite upload threw (non-fatal)", {
			backupId,
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

/** systemd units that must be stopped for an offline restore (see deploy.sh). */
const PLATFORM_SERVICE_UNITS = ["vcontrolhub-next", "vcontrolhub-worker", "vcontrolhub-ssh-ws"];

export type OfflineRestorePlan = {
	id: string;
	type: string;
	component: "database" | "files" | "all";
	filePath: string;
	checksumSha256: string;
	checksumVerifiedAt: string;
	commands: {
		/** null where the platform does not run under systemd (Windows). */
		stopServices: string | null;
		safetySnapshot: string;
		restore: string;
		startServices: string | null;
	};
};

/**
 * Restore is offline only. Web requests, workers, agent callbacks, schedules
 * and terminal sessions all write to the database and the file tree, and none
 * of them can be paused reliably from inside the running platform (a gate that
 * workers check before claiming is check-then-act: a worker that passed it can
 * still start after the restore began). So the app no longer restores: it
 * verifies the artifact and hands the operator the exact offline runbook. The
 * restore scripts check the prerequisite themselves — they refuse unless every
 * platform systemd unit is confirmed stopped and no other client is connected
 * to the database (the first statement of the import transaction, repeated
 * before the file phase). Those are point-in-time checks: the operator keeps
 * every instance stopped until the restore finished.
 */
export async function prepareOfflineRestore(input: {
	id: string;
	projectRoot?: string;
	component?: "database" | "files" | "all";
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
}): Promise<OfflineRestorePlan> {
	const record = await getBackupRecord(input.id, input.session);
	if (!record) {
		throw new NotFoundError(t("backend.backup.recordNotFound"));
	}
	if (record.status !== "COMPLETED") {
		throw new BusinessError(t("backend.backup.onlyCompletedCanRestore"));
	}
	if (!isBackupType(record.type)) throw new ValidationError(t("backend.backup.invalidType"));
	const projectRoot = input.projectRoot || config.app.appDir || process.cwd();
	const type = record.type;
	const component = type === "FULL" ? (input.component ?? "all") : type === "FILES" ? "files" : "database";
	const backupPath = resolveBackupPath(projectRoot, record.filePath);
	await stat(backupPath);
	if (!record.checksumSha256) {
		throw new BusinessError(t("backend.backup.checksumMissing"));
	}
	const actualChecksum = await calculateFileSha256(backupPath);
	if (actualChecksum !== record.checksumSha256) {
		throw new BusinessError(t("backend.backup.checksumMismatch"));
	}
	const snapshotType = type === "FULL" ? (component === "database" ? "DATABASE" : component === "files" ? "FILES" : "FULL") : type;
	const snapshotPath = `backups/pre-restore-${record.id}-${Date.now()}${snapshotType === "DATABASE" ? ".sql.gz" : ".tar.gz"}`;
	const systemd = !IS_WINDOWS;
	return {
		id: record.id,
		type,
		component,
		filePath: record.filePath,
		checksumSha256: actualChecksum,
		checksumVerifiedAt: new Date().toISOString(),
		commands: {
			stopServices: systemd ? `sudo systemctl stop ${PLATFORM_SERVICE_UNITS.join(" ")}` : null,
			safetySnapshot: buildPortableBackupCommand({ projectRoot, outputPath: snapshotPath, type: snapshotType }),
			// The file just verified: records hold a path relative to the backup
			// storage root (BACKUP_DIR), not to the app directory the command
			// runs in, so the relative path pointed at a file that is not there.
			restore: buildBackupRestoreCommand({ projectRoot, backupPath: record.filePath, resolvedBackupPath: backupPath, type, component, confirm: true }),
			startServices: systemd ? `sudo systemctl start ${[...PLATFORM_SERVICE_UNITS].reverse().join(" ")}` : null,
		},
	};
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
	await verifyGzipIntegrity(backupPath, 5 * 60 * 1000);
	checks.push({ name: "gzip", status: "passed", detail: "Compressed stream integrity verified" });
	if (record.type === "DATABASE") {
		// Node zlib head probe — no shell pipeline, works wherever the app runs.
		const head = await probeGunzipHead(backupPath, 8192, 5 * 60 * 1000);
		if (!/PostgreSQL|SET |CREATE |DROP |COPY /i.test(head)) throw new BusinessError(t("backend.backup.drillNotPostgres"));
		checks.push({ name: "database-format", status: "passed", detail: "PostgreSQL SQL stream detected" });
	} else {
		// Use execFile argv (no shell). Do NOT put `--` between -f and the archive:
		// GNU tar treats the next token after -f as the archive name, so
		// `tar -tzf -- "$path"` opens an archive literally named `--`.
		// Path is already constrained by resolveBackupPath (portable under backups/).
			await runBackupCommand({ file: resolveLocalTarBinary(), args: ["-tzf", backupPath], options: { cwd: projectRoot, timeout: 10 * 60 * 1000 } });
			checks.push({ name: "archive-index", status: "passed", detail: "tar archive index parsed without extraction" });
			if (record.type === "FULL") {
				// Extract the embedded dump to a staging file and verify it with Node
				// zlib — same guarantee as `tar -xOzf | gzip -t`, no shell pipeline.
				const staging = await mkdtemp(join(tmpdir(), "vch-drill-"));
				try {
					await runBackupCommand({
						file: resolveLocalTarBinary(),
						args: ["-xzf", backupPath, "-C", staging, "database.sql.gz"],
						options: { cwd: projectRoot, timeout: 10 * 60 * 1000 },
					});
					await verifyGzipIntegrity(join(staging, "database.sql.gz"), 10 * 60 * 1000);
				} finally {
					await rm(staging, { recursive: true, force: true }).catch(() => undefined);
				}
				checks.push({ name: "full-database", status: "passed", detail: "Embedded PostgreSQL dump stream verified" });
			}
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
	/**
	 * Only the backups of this schedule (null: only manual backups). Left out,
	 * every backup of the customer counts — the explicit cleanup action.
	 */
	scheduleId?: string | null;
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
			...(input.scheduleId !== undefined ? { scheduleId: input.scheduleId } : {}),
			OR: [
				{ status: { in: ["COMPLETED", "FAILED", "VOIDED"] }, createdAt: { lt: cutoffForQuery } },
				// still load recent completed so keepLatestPerType can protect newest
				{ status: "COMPLETED" },
			],
		},
		orderBy: { createdAt: "desc" },
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
		let artifactCleanupSucceeded = !candidate.filePath;
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
							artifactCleanupSucceeded = true;
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
							artifactCleanupSucceeded = true;
						} catch (rmError) {
							if ((rmError as NodeJS.ErrnoException).code === "ENOENT") {
								filesSkipped += 1;
								artifactCleanupSucceeded = true;
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
		if (!artifactCleanupSucceeded) {
			continue;
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
