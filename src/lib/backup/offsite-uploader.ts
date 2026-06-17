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
import { readFile } from "node:fs/promises";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { getSetting } from "@/lib/settings/service";

import { S3Client, S3Error, type S3ClientConfig } from "@/lib/storage/offsite/s3-client";
import { loadOffsiteConfig, validateOffsiteConfigForUse } from "@/lib/storage/offsite/schema";

import { compressBuffer } from "./compress";
import { resolveBackupPath } from "./service-types";

const logger = createLogger("backup-offsite-uploader");

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
			reason: "offsite_disabled" | "config_invalid" | "backup_not_completed" | "file_missing";
			issues?: string[];
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
export async function uploadBackupToOffsite(input: {
	backupId: string;
	projectRoot?: string;
}): Promise<OffsiteUploadResult> {
	const projectRoot = input.projectRoot || process.cwd();
	// 1. 加载 offsite 配置
	let config;
	try {
		config = await loadOffsiteConfig();
	} catch (err) {
		return { ok: false, skipped: false, error: `配置加载失败: ${formatError(err)}`, code: "ConfigError" };
	}
	if (!config.enabled) {
		return { ok: true, skipped: true, reason: "offsite_disabled" };
	}
	const issues = validateOffsiteConfigForUse(config);
	if (issues.length > 0) {
		return { ok: true, skipped: true, reason: "config_invalid", issues };
	}
	// 2. 读 backup record
	const record = await prisma.backupRecord.findUnique({ where: { id: input.backupId } });
	if (!record) {
		return { ok: false, skipped: false, error: `备份记录 ${input.backupId} 不存在`, code: "BackupNotFound" };
	}
	if (record.status !== "COMPLETED") {
		return { ok: true, skipped: true, reason: "backup_not_completed" };
	}
	// 3. 读 backup 文件
	let fullPath: string;
	try {
		fullPath = resolveBackupPath(projectRoot, record.filePath);
	} catch (err) {
		return { ok: false, skipped: false, error: `备份路径无效: ${formatError(err)}`, code: "InvalidPath" };
	}
	let rawBuf: Buffer;
	try {
		rawBuf = await readFile(fullPath);
	} catch (_err) {
		return { ok: true, skipped: true, reason: "file_missing" };
	}
	// 4. 决定是否压缩
	const compressSetting = (await getSetting("offsite.compress")) || "true";
	const shouldCompress = compressSetting !== "false" && !record.filePath.endsWith(".gz");
	const compressed = shouldCompress ? compressBuffer(rawBuf) : { data: rawBuf, originalSize: rawBuf.length, compressedSize: rawBuf.length, ratio: 1 };
	const ext = shouldCompress ? ".gz" : "";
	const contentType = shouldCompress ? "application/gzip" : "application/octet-stream";
	// 5. 构造 S3 key
	const date = new Date();
	const dateStr = date.toISOString().slice(0, 10);
	const prefix = (config.pathPrefix || "vcontrolhub-backups/").replace(/\/+$/, "") + "/";
	const key = `${prefix}${dateStr}/${record.id}-${record.type.toLowerCase()}${ext}`;
	// 6. 推 S3
	const clientConfig: S3ClientConfig = {
		endpoint: config.endpoint,
		region: config.region,
		bucket: config.bucket,
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
	};
	const client = new S3Client(clientConfig);
	try {
		const { etag } = await client.putObject(key, compressed.data, contentType);
		// 7. 写 DB
		const uploadedAt = new Date();
		await prisma.backupRecord.update({
			where: { id: record.id },
			data: {
				offsiteKey: key,
				offsiteUploadedAt: uploadedAt,
				offsiteSize: String(compressed.compressedSize),
			},
		});
		logger.info("offsite upload ok", {
			backupId: record.id,
			key,
			originalSize: compressed.originalSize,
			compressedSize: compressed.compressedSize,
			ratio: compressed.ratio,
			etag,
		});
		return {
			ok: true,
			skipped: false,
			key,
			etag,
			originalSize: compressed.originalSize,
			compressedSize: compressed.compressedSize,
			compressed: shouldCompress,
			ratio: compressed.ratio,
			uploadedAt,
		};
	} catch (err) {
		const message = formatError(err);
		const code = err instanceof S3Error ? err.code : "UploadError";
		const failMessage = `[offsite-upload] ${code}: ${message}`.slice(0, 2000);
		// 失败也写 DB (把原因塞进 errorMessage), 但保留原 status=COMPLETED
		await prisma.backupRecord.update({
			where: { id: record.id },
			data: { errorMessage: failMessage },
		}).catch((dbErr) => {
			logger.warn("offsite upload: failed to record error message", { backupId: record.id, error: formatError(dbErr) });
		});
		logger.error("offsite upload failed", { backupId: record.id, code, error: message });
		return { ok: false, skipped: false, error: message, code };
	}
}

function formatError(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
