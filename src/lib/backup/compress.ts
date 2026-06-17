/**
 * TR-009 55a: 备份 gzip 压缩工具 (上传到 offsite S3 前先压)。
 *
 * 不引新依赖, 用 Node 22 内置 `node:zlib` 跑 gzip。
 * 两个入口:
 *   - compressBuffer(buf)        → 适合小文件 / 已经读入内存的数据
 *   - compressFileToGz(src, dst) → 适合大备份文件, 流式不占内存
 *
 * 行为约定:
 *   - level 6 是 gzip 默认, 在压缩比和 CPU 之间平衡
 *   - 失败抛 Error 带 message, caller 自己捕获
 *   - 不会自动 strip .gz 后缀 (caller 决定要不要写 .gz 后缀)
 */
import { createGzip, gzipSync, type Gzip } from "node:zlib";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { stat } from "node:fs/promises";

export type CompressResult = {
	data: Buffer;
	originalSize: number;
	compressedSize: number;
	ratio: number; // 0-1, 越小越省; 0.4 = 压缩到 40% (节省 60%)
};

export type FileCompressResult = {
	originalSize: number;
	compressedSize: number;
	ratio: number;
};

/** 同步压缩一个 Buffer (适合 < 50MB 的小备份或测试场景)。 */
export function compressBuffer(input: Buffer): CompressResult {
	const compressed = gzipSync(input, { level: 6 });
	return buildResult(input, compressed);
}

/** 流式把 sourcePath 压缩成 targetPath (适合大备份文件)。 */
export async function compressFileToGz(sourcePath: string, targetPath: string): Promise<FileCompressResult> {
	// 先 stat 探一下, 避免 read stream 报 unhandled error event (pipeline 内部 attach 之前就 emit)
	const sourceStat = await stat(sourcePath);
	if (!sourceStat.isFile()) {
		throw new Error(`compressFileToGz: source is not a regular file: ${sourcePath}`);
	}
	const gzip: Gzip = createGzip({ level: 6 });
	const source = createReadStream(sourcePath);
	source.on("error", () => {}); // swallow — pipeline 仍会 reject, 防止 unhandled
	const target = createWriteStream(targetPath);
	const originalSize = sourceStat.size;
	await pipeline(source, gzip, target);
	const targetStat = await stat(targetPath);
	const compressedSize = targetStat.size;
	return {
		originalSize,
		compressedSize,
		ratio: originalSize === 0 ? 0 : compressedSize / originalSize,
	};
}

/** 估算压缩率 (不实际压缩, 拿流的前 64KB 估算; 适合 UI 显示)。 */
export async function estimateCompressionRatio(filePath: string): Promise<number | null> {
	try {
		const sourceStat = await stat(filePath);
		if (sourceStat.size === 0) return 0;
		if (sourceStat.size < 4096) {
			// 文件太小, 估不准
			return null;
		}
		// 用 64KB 采样估算
		const { open } = await import("node:fs/promises");
		const fh = await open(filePath, "r");
		try {
			const sample = Buffer.alloc(64 * 1024);
			const { bytesRead } = await fh.read(sample, 0, sample.length, 0);
			const compressed = gzipSync(sample.subarray(0, bytesRead), { level: 6 });
			return compressed.length / bytesRead;
		} finally {
			await fh.close();
		}
	} catch {
		return null;
	}
}

function buildResult(original: Buffer, compressed: Buffer): CompressResult {
	const originalSize = original.length;
	const compressedSize = compressed.length;
	return {
		data: compressed,
		originalSize,
		compressedSize,
		ratio: originalSize === 0 ? 0 : compressedSize / originalSize,
	};
}
