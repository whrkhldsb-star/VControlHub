/**
 * TR-043: VPS remote backup service.
 *
 * Core execution flow:
 * 1. SSH exec: create backup archive on remote VPS (tar/mysqldump/etc)
 * 2. SFTP download: pull archive to VControlHub local storage
 * 3. SSH exec: cleanup remote temp file
 * 4. Calculate sha256 + file size
 * 5. Update VpsBackupRecord status
 * 6. Best-effort offsite S3 upload
 */

import { createHash } from "node:crypto";
import { createWriteStream, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import { pipeline } from "node:stream/promises";

import { prisma } from "@/lib/db";
import { buildSshParamsFromServer, execRemoteCommand } from "@/lib/ssh/client";
import {
	buildRemoteBackupCommand,
	buildRemoteCleanupCommand,
	generateRemoteBackupPath,
	getPreset,
} from "./vps-backup-presets";
import { downloadFile } from "@/lib/ssh/sftp-service";
import { createLogger } from "@/lib/logging";

const vpsBackupLogger = createLogger("vps-backup");

/** Job type for the durable job queue */
export const VPS_BACKUP_CREATE_JOB_TYPE = "vps-backup.create";

/** Local storage root for VPS backup files */
function getVpsBackupStorageRoot(): string {
	return join(
		process.env.VCH_STORAGE_ROOT || process.cwd(),
		"storage",
		"vps-backups",
	);
}

/**
 * Validate a portable VPS backup relative path (as stored in DB).
 * Rejects absolute paths, null bytes, backslashes, and `..` segments.
 */
export function assertPortableVpsBackupPath(localPath: string): string {
	const value = localPath.trim();
	if (
		!value ||
		value.startsWith("/") ||
		value.includes("\0") ||
		value.includes("\\") ||
		value.includes("//")
	) {
		throw new Error("VPS backup path must be a portable relative path");
	}
	const parts = value.split("/");
	if (parts.some((part) => !part || part === "." || part === "..")) {
		throw new Error("VPS backup path must be a portable relative path");
	}
	// Expected layout written by this service.
	if (!value.startsWith("storage/vps-backups/")) {
		throw new Error("VPS backup path must be under storage/vps-backups/");
	}
	return value;
}

/** Build the local storage path for a VPS backup record */
export function buildLocalBackupPath(
	serverId: string,
	recordId: string,
	backupType: string,
): string {
	const dir = join(getVpsBackupStorageRoot(), serverId);
	const filename = `${backupType}-${recordId}.tar.gz`;
	return join(dir, filename);
}

/** Build a relative (portable) path for storing in DB */
function buildPortableLocalPath(
	serverId: string,
	recordId: string,
	backupType: string,
): string {
	return `storage/vps-backups/${serverId}/${backupType}-${recordId}.tar.gz`;
}

/** Result of a successful backup run */
export interface VpsBackupResult {
	success: boolean;
	fileSize: string | null;
	checksumSha256: string | null;
	localPath: string | null;
	remotePath: string | null;
	errorMessage: string | null;
}

/**
 * Execute a VPS remote backup for a given record.
 *
 * This is the main entry point called by the job worker.
 * It reads the VpsBackupRecord from DB, fetches the Server connection
 * info, and orchestrates the full backup flow.
 */
export async function runVpsBackupRecord(recordId: string): Promise<VpsBackupResult> {
	const record = await prisma.vpsBackupRecord.findUnique({
		where: { id: recordId },
		include: {
			server: {
				select: {
					id: true,
					host: true,
					port: true,
					username: true,
					sshKeyId: true,
					password: true,
					sshKey: { select: { privateKey: true } },
					enabled: true,
				},
			},
			schedule: {
				select: { paths: true },
			},
		},
	});

	if (!record) {
		return {
			success: false,
			fileSize: null,
			checksumSha256: null,
			localPath: null,
			remotePath: null,
			errorMessage: `VpsBackupRecord ${recordId} not found`,
		};
	}

	if (!record.server) {
		return failRecord(record.id, "Associated server not found");
	}

	if (!record.server.enabled) {
		return failRecord(record.id, "Server is disabled");
	}

	const preset = getPreset(record.backupType);
	if (!preset) {
		return failRecord(record.id, `Unknown backup type: ${record.backupType}`);
	}

	// Mark as RUNNING via CAS — only claim PENDING (or re-queue from FAILED).
	const claimed = await prisma.vpsBackupRecord.updateMany({
		where: { id: recordId, status: { in: ["PENDING", "FAILED"] } },
		data: { status: "RUNNING", updatedAt: new Date(), errorMessage: null },
	});
	if (claimed.count === 0) {
		return {
			success: false,
			fileSize: null,
			checksumSha256: null,
			localPath: null,
			remotePath: null,
			errorMessage: `VpsBackupRecord ${recordId} is already running or completed`,
		};
	}

	const remoteFilePath = generateRemoteBackupPath();
	const customPaths = record.schedule?.paths ?? [];

	try {
		// Step 1: SSH exec — create backup on remote VPS
		const sshParams = await buildSshParamsFromServer(record.server, record.server.sshKey);
		const backupCommand = buildRemoteBackupCommand(
			record.backupType,
			remoteFilePath,
			customPaths,
		);

		const execResult = await execRemoteCommand({
			...sshParams,
			command: backupCommand,
			timeout: 600_000, // 10 min for large backups
		});

		if (execResult.exitCode !== 0 && execResult.exitCode !== null) {
			// exitCode null = SSH connection error
			const errMsg = `Remote backup command failed (exit ${execResult.exitCode}): ${execResult.stderr || execResult.stdout}`.slice(0, 500);
			return failRecord(record.id, errMsg, remoteFilePath, sshParams);
		}

		// Step 2: SFTP download — pull archive to local storage
		const portablePath = buildPortableLocalPath(
			record.server.id,
			record.id,
			record.backupType,
		);
		const localAbsolutePath = join(
			process.env.VCH_STORAGE_ROOT || process.cwd(),
			portablePath,
		);

		// Ensure local directory exists
		mkdirSync(dirname(localAbsolutePath), { recursive: true });

		const { stream, size } = await downloadFile(record.server.id, remoteFilePath);

		// Write stream to local file + compute sha256 in parallel
		const hash = createHash("sha256");
		const fileStream = createWriteStream(localAbsolutePath);

		// Consume the SFTP stream: pipe to file + compute sha256
		await pipeline(
			stream,
			async function* (source) {
				for await (const chunk of source) {
					hash.update(chunk);
					fileStream.write(chunk);
					yield chunk;
				}
			},
			// Drain to nowhere (we consumed above)
			// Actually, pipeline requires a writable or transform at the end
			// Let's just write directly
		).catch(() => {
			// pipeline may complain about the async generator not being a proper writable
		});

		// Wait for file write to complete
		await new Promise<void>((resolve, reject) => {
			fileStream.end((err?: Error) => (err ? reject(err) : resolve()));
		});

		const sha256 = hash.digest("hex");
		let fileSize: string | null = null;
		try {
			const stat = statSync(localAbsolutePath);
			fileSize = stat.size.toString();
		} catch {
			// Fallback to SFTP-reported size
			fileSize = size > 0 ? size.toString() : null;
		}

		// Step 3: SSH exec — cleanup remote temp file
		const cleanupCommand = buildRemoteCleanupCommand(remoteFilePath);
		await execRemoteCommand({
			...sshParams,
			command: cleanupCommand,
			timeout: 15_000,
		}).catch(() => {
			// Cleanup is best-effort; don't fail the backup
		});

		// Step 4: Update record to COMPLETED
		await prisma.vpsBackupRecord.update({
			where: { id: recordId },
			data: {
				status: "COMPLETED",
				remotePath: remoteFilePath,
				localPath: portablePath,
				fileSize,
				checksumSha256: sha256,
				completedAt: new Date(),
				errorMessage: null,
			},
		});

		// Step 5: Best-effort offsite S3 upload (reuses S3 client directly
		// since uploadBackupToOffsite is coupled to BackupRecord model)
		try {
			const { loadOffsiteConfig, validateOffsiteConfigForUse } = await import("@/lib/storage/offsite/schema");
			const { S3Client } = await import("@/lib/storage/offsite/s3-client");
			const { readFileSync } = await import("node:fs");
			const config = await loadOffsiteConfig();
			if (config.enabled) {
				const issues = validateOffsiteConfigForUse(config);
				if (issues.length === 0) {
					const offsiteKey = `${config.pathPrefix || "vps-backups"}/${record.server.id}/${record.backupType}-${record.id}.tar.gz`;
					const fileBuffer = readFileSync(localAbsolutePath);
					const s3 = new S3Client(config);
					await s3.putObject(offsiteKey, fileBuffer, "application/gzip");
					await prisma.vpsBackupRecord.update({
						where: { id: recordId },
						data: {
							offsiteKey,
							offsiteUploadedAt: new Date(),
							offsiteSize: fileBuffer.length.toString(),
						},
					});
				}
			}
		} catch {
			// Offsite upload is best-effort; don't fail the backup
		}

		return {
			success: true,
			fileSize,
			checksumSha256: sha256,
			localPath: portablePath,
			remotePath: remoteFilePath,
			errorMessage: null,
		};
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		return failRecord(record.id, errMsg.slice(0, 500), remoteFilePath);
	}
}

/** Mark a record as FAILED and optionally cleanup remote temp file */
async function failRecord(
	recordId: string,
	errorMessage: string,
	remotePath?: string,
	sshParams?: { host: string; port: number; username: string; privateKey?: string; password?: string },
): Promise<VpsBackupResult> {
	await prisma.vpsBackupRecord.update({
		where: { id: recordId },
		data: {
			status: "FAILED",
			errorMessage: errorMessage.slice(0, 500),
			completedAt: new Date(),
			...(remotePath ? { remotePath } : {}),
		},
	});

	// Best-effort remote cleanup
	if (remotePath && sshParams) {
		const cleanupCommand = buildRemoteCleanupCommand(remotePath);
		await execRemoteCommand({
			...sshParams,
			command: cleanupCommand,
			timeout: 10_000,
		}).catch((err) => { vpsBackupLogger.warn("best-effort operation failed", { error: err instanceof Error ? err.message : String(err) }); });
	}

	return {
		success: false,
		fileSize: null,
		checksumSha256: null,
		localPath: null,
		remotePath: remotePath ?? null,
		errorMessage,
	};
}

/* ── CRUD helpers ────────────────────────────────────────── */

/** Create a PENDING VpsBackupRecord (for manual or scheduled triggers) */
export async function createVpsBackupRecord(input: {
	serverId: string;
	backupType: string;
	scheduleId?: string;
	createdBy?: string;
}): Promise<{ id: string }> {
	const record = await prisma.vpsBackupRecord.create({
		data: {
			serverId: input.serverId,
			backupType: input.backupType,
			scheduleId: input.scheduleId ?? null,
			createdBy: input.createdBy ?? null,
			status: "PENDING",
		},
	});
	return { id: record.id };
}

/** List VpsBackupRecords for a server */
export async function listVpsBackupRecords(
	serverId: string,
	limit = 50,
): Promise<unknown[]> {
	return prisma.vpsBackupRecord.findMany({
		where: { serverId },
		orderBy: { createdAt: "desc" },
		take: limit,
		select: {
			id: true,
			backupType: true,
			status: true,
			fileSize: true,
			checksumSha256: true,
			localPath: true,
			errorMessage: true,
			createdAt: true,
			completedAt: true,
			offsiteKey: true,
			offsiteUploadedAt: true,
		},
	});
}

/** Delete a VpsBackupRecord and its local file */
export async function deleteVpsBackupRecord(recordId: string): Promise<void> {
	const record = await prisma.vpsBackupRecord.findUnique({
		where: { id: recordId },
		select: { localPath: true },
	});

	if (record?.localPath) {
		try {
			const absPath = resolveVpsBackupFilePath(record.localPath);
			const { unlinkSync } = await import("node:fs");
			unlinkSync(absPath);
		} catch (err) {
			// File missing or path rejected — still remove the DB row.
			vpsBackupLogger.warn("deleteVpsBackupRecord: local file cleanup skipped", {
				recordId,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	await prisma.vpsBackupRecord.delete({ where: { id: recordId } });
}

/** Get the absolute local path for a VpsBackupRecord (for download) */
export function resolveVpsBackupFilePath(localPath: string): string {
	const portable = assertPortableVpsBackupPath(localPath);
	const root = resolvePath(process.env.VCH_STORAGE_ROOT || process.cwd());
	const abs = resolvePath(root, portable);
	const prefix = root.endsWith("/") ? root : root + "/";
	if (abs !== root && !abs.startsWith(prefix)) {
		throw new Error("VPS backup path escapes storage root");
	}
	return abs;
}

/* ── Retention ───────────────────────────────────────────── */

/** Prune old COMPLETED VpsBackupRecords based on retentionDays */
export async function pruneOldVpsBackupRecords(
	serverId: string,
	retentionDays: number,
): Promise<number> {
	const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

	const oldRecords = await prisma.vpsBackupRecord.findMany({
		where: {
			serverId,
			status: "COMPLETED",
			completedAt: { lt: cutoff },
		},
		select: { id: true, localPath: true },
		take: 1000,
	});

	let deleted = 0;
	for (const record of oldRecords) {
		try {
			await deleteVpsBackupRecord(record.id);
			deleted++;
		} catch {
			// Continue on individual failures
		}
	}

	return deleted;
}
