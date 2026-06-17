/**
 * TR-009 55a: compress module unit tests.
 *
 * 覆盖:
 *   - compressBuffer: 大数据 / 小数据 / 空 buffer / 压缩比 < 1
 *   - compressFileToGz: 文件写入 + 压缩比 < 1 + 文件可读回
 *   - estimateCompressionRatio: 大文件 / 小文件 / 不存在文件
 */
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { compressBuffer, compressFileToGz, estimateCompressionRatio } from "../compress";

describe("compressBuffer", () => {
	it("压缩一个含重复 pattern 的 buffer, 压缩比 < 1", () => {
		const raw = Buffer.alloc(64 * 1024, "abcdefghij");
		const { data, originalSize, compressedSize, ratio } = compressBuffer(raw);
		expect(originalSize).toBe(raw.length);
		expect(compressedSize).toBeLessThan(originalSize);
		expect(ratio).toBeLessThan(1);
		expect(data.length).toBeGreaterThan(0);
	});

	it("空 buffer 返 ratio=0 (不报错)", () => {
		const { originalSize, compressedSize, ratio } = compressBuffer(Buffer.alloc(0));
		expect(originalSize).toBe(0);
		expect(ratio).toBe(0);
		// gzip 仍会输出空 stream header (~20 字节)
		expect(compressedSize).toBeGreaterThanOrEqual(0);
	});

	it("高度随机数据压缩比 >= 0.9 (基本压不动)", () => {
		const raw = Buffer.from(
			Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256)),
		);
		const { ratio, originalSize, compressedSize } = compressBuffer(raw);
		expect(ratio).toBeGreaterThan(0.9);
		expect(compressedSize).toBeGreaterThanOrEqual(originalSize * 0.9);
	});
});

describe("compressFileToGz", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "compress-test-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("把一个文件压缩写到目标 .gz, 写出的文件能 readFile 回来 (gzip 头)", async () => {
		const src = join(dir, "raw.txt");
		const dst = join(dir, "raw.txt.gz");
		const original = "x".repeat(100_000);
		await writeFile(src, original);
		const { originalSize, compressedSize, ratio } = await compressFileToGz(src, dst);
		const targetStat = await stat(dst);
		expect(targetStat.size).toBe(compressedSize);
		expect(originalSize).toBe(100_000);
		expect(ratio).toBeLessThan(0.1); // 高度重复, 压成 1% 左右
		const head = (await readFile(dst)).subarray(0, 2);
		// gzip magic header = 0x1f 0x8b
		expect(head[0]).toBe(0x1f);
		expect(head[1]).toBe(0x8b);
	});

	it("源文件不存在时 pipeline 抛错", async () => {
		const src = join(dir, "missing.txt");
		const dst = join(dir, "out.gz");
		// compressFileToGz 内置 stat 探针, 缺文件直接抛 ENOENT
		await expect(compressFileToGz(src, dst)).rejects.toThrow(/ENOENT|no such file/);
	});
});

describe("estimateCompressionRatio", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "estimate-test-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("大文件 + 重复 pattern, 估出 ratio < 0.5", async () => {
		const src = join(dir, "big.txt");
		await writeFile(src, "y".repeat(200_000));
		const ratio = await estimateCompressionRatio(src);
		expect(ratio).not.toBeNull();
		expect(ratio!).toBeLessThan(0.5);
	});

	it("小文件 (4KB 以下) 返 null (估不准)", async () => {
		const src = join(dir, "small.txt");
		await writeFile(src, "hello world");
		const ratio = await estimateCompressionRatio(src);
		expect(ratio).toBeNull();
	});

	it("不存在的文件返 null (不抛)", async () => {
		const ratio = await estimateCompressionRatio(join(dir, "nope.txt"));
		expect(ratio).toBeNull();
	});

	it("空文件 (0 字节) 返 0 (跟 isEmpty 短路)", async () => {
		const src = join(dir, "empty.txt");
		await writeFile(src, "");
		const ratio = await estimateCompressionRatio(src);
		expect(ratio).toBe(0);
	});
});
