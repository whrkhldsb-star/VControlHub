/**
 * TR-009 55a: 备份 → 异地 S3 上传 pipeline。
 *
 * 目标: 走完 "backup 完成 → (可选 gzip 压缩) → S3 putObject → 写 offsiteKey/offsiteUploadedAt/offsiteSize"
 * 整条链, 同时 best-effort: offsite 失败不影响 backup 本体的 COMPLETED 状态,
 * 只把失败原因写到 BackupRecord.errorMessage (前缀 [offsite-upload]) 让 UI / 日志可查。
 *
 * 设计要点:
 *   - 不引新依赖, 复用 M03 S3Client (s3-compatible 通用, 同样适用于 B2/R2/MinIO)
 *   - 走 Node 22 内置 zlib 压缩, 失败回退到原文件 PUT
 *   - 失败不抛 — 返 OffsiteUploadResult 让 caller 决定写日志还是改 DB
 *   - S3 key 规则: `${pathPrefix}${YYYY-MM-DD}/${backupId}-${type}${ext}`
 *     其中 ext = `.gz` 走压缩, `` 不压缩; pathPrefix 默认 `vcontrolhub-backups/`
 */
import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";
import { createHash } from "node:crypto";
import { ChecksumMismatchError, verifyRecordedChecksum } from "@/lib/crypto/sha256-file";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { config as appConfig } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { getSetting } from "@/lib/settings/service";
import { sendEmail } from "@/lib/notification/email";

import { S3Client, S3Error, type S3ClientConfig } from "@/lib/storage/offsite/s3-client";
import { loadOffsiteConfig, validateOffsiteConfigForUse } from "@/lib/storage/offsite/schema";

import { compressBuffer, compressFileToGz } from "./compress";
import { resolveBackupPath, PLATFORM_RECEIPT_PREFIX, platformOffsiteDestination } from "./service-types";

const logger = createLogger("backup-offsite-uploader");

export async function sendOffsiteFailureAlert(input: {
	recipient?: string | null;
	backupLabel: string;
	error: string;
}) {
	const recipient = input.recipient?.trim();
	if (!recipient) return false;
	try {
		await sendEmail({
			to: recipient,
			subject: `VControlHub offsite backup failed: ${input.backupLabel}`,
			text: `The local backup completed, but its offsite upload failed.\n\nBackup: ${input.backupLabel}\nError: ${input.error}`,
		});
		return true;
	} catch (error) {
		logger.warn("offsite failure alert delivery failed", {
			backupLabel: input.backupLabel,
			error: formatError(error),
		});
		return false;
	}
}

export type OffsiteUploadResult =
	| {
			ok: true;
			skipped: false;
			key: string;
			etag: string;
			originalSize: number;
			compressedSize: number;
			compressed: boolean;
			ratio: number;
			uploadedAt: Date;
	  }
	| {
			ok: true;
			skipped: true;
			reason: "offsite_disabled" | "backup_not_completed" | "offsite_expired" | "already_uploaded" | "backup_busy";
	  }
	| {
			ok: false;
			skipped: false;
			error: string;
			code: string;
	  };

/**
 * 把指定 backup 推到 offsite S3 (best-effort)。
 * 不抛 — 返 OffsiteUploadResult 让 caller 决定怎么处理。
 */
type PlatformUpload = {
	backupId: string;
	projectRoot?: string;
	/**
	 * Email the failure alert for this backup (default). The catch-up sweep
	 * turns it off and sends one summary instead: per-record alerts from a
	 * sweep meant one email per pending backup per attempt.
	 */
	alert?: boolean;
	/** Optional lease-abort signal from a durable backup worker. */
	signal?: AbortSignal;
};

export async function uploadBackupToOffsite(input: PlatformUpload): Promise<OffsiteUploadResult> {
	if (input.signal?.aborted) {
		throw input.signal.reason ?? new Error("Offsite upload aborted");
	}
	let release;
	try {
		release = await tryAcquireAdvisoryLock("platform-backup-artifact", input.backupId);
		if (!release) return { ok: true, skipped: true, reason: "backup_busy" };
		input.signal?.throwIfAborted();
		return await uploadLocked(input);
	} catch (error) {
		if (input.signal?.aborted) throw error;
		return { ok: false, skipped: false, code: "UploadError", error: "Offsite upload failed" };
	} finally {
		await release?.();
	}
}

async function uploadLocked(input: PlatformUpload): Promise<OffsiteUploadResult> {
	const projectRoot = input.projectRoot || appConfig.app.appDir || process.cwd();
	const alertOn = input.alert !== false;
	// Load the record first so every actionable failure can be persisted.
	const record = await prisma.backupRecord.findUnique({ where: { id: input.backupId } });
	if (!record) {
		return { ok: false, skipped: false, error: `Backup record ${input.backupId} does not exist`, code: "BackupNotFound" };
	}
	if (record.status !== "COMPLETED") {
		return { ok: true, skipped: true, reason: "backup_not_completed" };
	}

	if (record.offsiteKey) return { ok: true, skipped: true, reason: "already_uploaded" };
	if (record.offsiteSize != null) {
		return { ok: true, skipped: true, reason: "offsite_expired" };
	}

	// 1. 加载 offsite 配置
	let config;
	try {
		config = await loadOffsiteConfig();
	} catch (err) {
		return recordOffsiteFailure({
			record,
			code: "ConfigError",
			error: `Configuration load failed: ${formatError(err)}`,
		});
	}
	if (!config.enabled) {
		return { ok: true, skipped: true, reason: "offsite_disabled" };
	}
	const issues = validateOffsiteConfigForUse(config);
	if (issues.length > 0) {
		return recordOffsiteFailure({
			record,
			recipient: alertOn ? config.failureAlertRecipient : null,
			code: "ConfigInvalid",
			error: `Offsite configuration invalid: ${issues.join("; ")}`,
		});
	}
	// 3. 读 backup 文件
	let fullPath: string;
	try {
		fullPath = resolveBackupPath(projectRoot, record.filePath);
	} catch (err) {
		return recordOffsiteFailure({
			record,
			recipient: alertOn ? config.failureAlertRecipient : null,
			code: "InvalidPath",
			error: `Invalid backup path: ${formatError(err)}`,
		});
	}
	let fileStat;
	try {
		fileStat = await stat(fullPath);
		if (!fileStat.isFile()) {
			return recordOffsiteFailure({
				record,
				recipient: alertOn ? config.failureAlertRecipient : null,
				code: "FileMissing",
				error: "Backup artifact is missing or is not a file",
			});
		}
	} catch (_err) {
		return recordOffsiteFailure({
			record,
			recipient: alertOn ? config.failureAlertRecipient : null,
			code: "FileMissing",
			error: "Backup artifact is missing or cannot be read",
		});
	}
	// 4. 决定是否压缩
	let compressSetting: string;
	try {
		compressSetting = (await getSetting("offsite.compress")) || "true";
	} catch (err) {
		return recordOffsiteFailure({
			record,
			recipient: alertOn ? config.failureAlertRecipient : null,
			code: "SettingError",
			error: `Compression setting load failed: ${formatError(err)}`,
		});
	}
	const shouldCompress = compressSetting !== "false" && !record.filePath.endsWith(".gz");
	// Prefer streaming gzip for larger artifacts to avoid full-file double buffering.
	const STREAM_COMPRESS_THRESHOLD_BYTES = 8 * 1024 * 1024;
	let body: Buffer | null = null;
	let uploadPath: string | null = null;
	let originalSize = fileStat.size;
	let compressedSize = fileStat.size;
	let ratio = 1;
	let compressed = false;
	let tempGzPath: string | null = null;
	try {
		input.signal?.throwIfAborted();
		if (shouldCompress && fileStat.size >= STREAM_COMPRESS_THRESHOLD_BYTES) {
			const tempDir = await mkdtemp(path.join(tmpdir(), "vch-offsite-"));
			tempGzPath = path.join(tempDir, `${record.id}.gz`);
			const result = await compressFileToGz(fullPath, tempGzPath);
			verifyRecordedChecksum(result.checksumSha256, record.checksumSha256);
			uploadPath = tempGzPath;
			originalSize = result.originalSize;
			compressedSize = result.compressedSize;
			ratio = result.ratio;
			compressed = true;
		} else if (!shouldCompress && fileStat.size >= STREAM_COMPRESS_THRESHOLD_BYTES) {
			uploadPath = fullPath;
		} else {
			const rawBuf = await readFile(fullPath);
			input.signal?.throwIfAborted();
			verifyRecordedChecksum(createHash("sha256").update(rawBuf).digest("hex"), record.checksumSha256);
			if (shouldCompress) {
				const result = compressBuffer(rawBuf);
				body = result.data;
				originalSize = result.originalSize;
				compressedSize = result.compressedSize;
				ratio = result.ratio;
				compressed = true;
			} else {
				body = rawBuf;
			}
		}
	} catch (err) {
		if (tempGzPath) {
			await rm(path.dirname(tempGzPath), { recursive: true, force: true }).catch(() => {});
		}
		if (input.signal?.aborted) throw err;
		return recordOffsiteFailure({
			record,
			recipient: alertOn ? config.failureAlertRecipient : null,
			code: err instanceof ChecksumMismatchError ? "ChecksumMismatch" : "CompressError",
			error: `Prepare upload body failed: ${formatError(err)}`,
		});
	}
	const ext = compressed ? ".gz" : "";
	const contentType = compressed ? "application/gzip" : "application/octet-stream";
	// 5. 构造 S3 key
	const dateStr = appTimeZoneDateKey(new Date());
	const prefix = (config.pathPrefix || "vcontrolhub-backups/").replace(/\/+$/, "") + "/";
	const key = `${prefix}${dateStr}/${record.id}-${record.type.toLowerCase()}${ext}`;
	// 6. 推 S3
	const clientConfig: S3ClientConfig = {
		endpoint: config.endpoint,
		region: config.region,
		bucket: config.bucket,
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
		timeoutMs: 30 * 60 * 1000,
	};
	try {
		input.signal?.throwIfAborted();
		const client = new S3Client(clientConfig);
		const { etag, versionId } = uploadPath
			? await client.putFile(key, uploadPath, contentType, compressed ? undefined : record.checksumSha256)
			: await client.putObject(key, body!, contentType);
		// 7. 写 DB (always persist receipt once the remote object upload succeeded)
		const uploadedAt = new Date();
		const receiptKey = PLATFORM_RECEIPT_PREFIX + record.id;
		const receipt = JSON.stringify({ destination: platformOffsiteDestination(config), key, versionId: versionId ?? null, type: record.type, uploadedAt });
		await prisma.$transaction([prisma.setting.upsert({ where: { key: receiptKey }, create: { key: receiptKey, value: receipt }, update: { value: receipt } }),
			prisma.backupRecord.update({
			where: { id: record.id, status: "COMPLETED", offsiteKey: null, offsiteSize: null },
			data: {
				offsiteKey: key,
				offsiteUploadedAt: uploadedAt,
				offsiteSize: String(compressedSize),
				errorMessage: null,
			},
		})]);
		logger.info("offsite upload ok", {
			backupId: record.id,
			key,
			originalSize,
			compressedSize,
			ratio,
			etag,
		});
		return {
			ok: true,
			skipped: false,
			key,
			etag,
			originalSize,
			compressedSize,
			compressed,
			ratio,
			uploadedAt,
		};
	} catch (err) {
		if (input.signal?.aborted) throw err;
		const message = formatError(err);
		const code = err instanceof ChecksumMismatchError ? "ChecksumMismatch" : err instanceof S3Error ? err.code : "UploadError";
		return recordOffsiteFailure({
			record,
			recipient: alertOn ? config.failureAlertRecipient : null,
			code,
			error: message,
		});
	} finally {
		if (tempGzPath) {
			await rm(path.dirname(tempGzPath), { recursive: true, force: true }).catch(() => {});
		}
	}
}

export async function retryPendingOffsiteUploads(input: {
	projectRoot?: string;
	limit?: number;
} = {}) {
	const maxRecords = input.limit === undefined
		? Number.POSITIVE_INFINITY
		: Math.max(1, Math.min(input.limit, 5000));
	let uploaded = 0;
	let failed = 0;
	let skipped = 0;
	let observed = 0;
	const errors: string[] = [];
	let after: PendingOffsiteKey | null = null;
	while (observed < maxRecords) {
		const take = Math.min(100, maxRecords - observed);
		const records: PendingOffsiteKey[] = await prisma.backupRecord.findMany({
			where: { status: "COMPLETED", offsiteKey: null, offsiteSize: null, ...pendingOffsiteAfter(after) },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			take,
			select: { id: true, createdAt: true },
		});
		if (records.length === 0) break;
		for (const record of records) {
			const result = await uploadBackupToOffsite({
				backupId: record.id,
				projectRoot: input.projectRoot,
				alert: false,
			});
			if (result.ok && !result.skipped) uploaded += 1;
			else if (result.ok) skipped += 1;
			else {
				failed += 1;
				if (errors.length < 5) errors.push(`${record.id}: ${result.code}: ${result.error}`);
			}
		}
		observed += records.length;
		if (records.length < take) break;
		after = records.at(-1)!;
	}
	return { observed, uploaded, failed, skipped, errors };
}

export type PendingOffsiteKey = { id: string; createdAt: Date };

/**
 * The rows after `after` in (createdAt, id) order, for the catch-up sweeps.
 *
 * A keyset, not Prisma's `cursor` with `skip: 1`: a backup that was just
 * uploaded no longer matches "offsiteKey is null", and with the cursor row
 * gone from the result the skip fell on the first row that still matched. Each
 * page after a successful one left one backup out of the run.
 */
export function pendingOffsiteAfter(after: PendingOffsiteKey | null) {
	if (!after) return {};
	return { OR: [{ createdAt: { gt: after.createdAt } }, { createdAt: after.createdAt, id: { gt: after.id } }] };
}

async function recordOffsiteFailure(input: {
	record: { id: string; type: string };
	recipient?: string | null;
	code: string;
	error: string;
}): Promise<OffsiteUploadResult> {
	const failMessage = `[offsite-upload] ${input.code}: ${input.error}`.slice(0, 2000);
	await prisma.backupRecord.update({
		where: { id: input.record.id },
		data: { errorMessage: failMessage },
	}).catch((dbErr) => {
		logger.warn("offsite upload: failed to record error message", {
			backupId: input.record.id,
			error: formatError(dbErr),
		});
	});
	logger.error("offsite upload failed", {
		backupId: input.record.id,
		code: input.code,
		error: input.error,
	});
	await sendOffsiteFailureAlert({
		recipient: input.recipient,
		backupLabel: `${input.record.type} ${input.record.id}`,
		error: `${input.code}: ${input.error}`,
	});
	return { ok: false, skipped: false, error: input.error, code: input.code };
}

function formatError(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
