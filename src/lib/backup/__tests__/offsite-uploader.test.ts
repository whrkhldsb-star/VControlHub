/**
 * TR-009 55a: offsite-uploader unit tests.
 *
 * 覆盖 (best-effort pipeline):
 *   - offsite disabled → ok=true skipped=offsite_disabled
 *   - config invalid (缺字段) → ok=true skipped=config_invalid + issues 含字段名
 *   - backup record 不存在 → ok=false
 *   - backup record status != COMPLETED → ok=true skipped=backup_not_completed
 *   - happy path: mock S3Client + mock prisma → ok=true, key 含 backupId, etag 写回
 *   - 失败: S3 PUT 抛 S3Error → ok=false, errorMessage 写进 backup record (前缀 [offsite-upload])
 *
 * 用 vitest.mock 拦截 S3Client + prisma + getSetting + loadOffsiteConfig, 跟 M03 s3-client test
 * 一样的 fetchImpl 注入模式, 不去碰真 S3。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
	prisma: {
		backupRecord: {
			findUnique: vi.fn(),
			update: vi.fn(),
		},
	},
}));

vi.mock("@/lib/settings/service", () => ({
	getSetting: vi.fn(),
}));

const { loadConfigMock, validateForUseMock } = vi.hoisted(() => {
	return {
		loadConfigMock: vi.fn<(...args: unknown[]) => unknown>(),
		validateForUseMock: vi.fn<(...args: unknown[]) => unknown>(),
	};
});

vi.mock("@/lib/storage/offsite/schema", () => ({
	loadOffsiteConfig: (loadConfigMock as unknown as (...args: unknown[]) => unknown),
	validateOffsiteConfigForUse: (validateForUseMock as unknown as (...args: unknown[]) => unknown),
}));

const { putObjectMock, headObjectMock, deleteObjectMock, listObjectsMock, MockS3Client, S3ErrorClass } = vi.hoisted(() => {
	const putObjectMock = vi.fn();
	const headObjectMock = vi.fn();
	const deleteObjectMock = vi.fn();
	const listObjectsMock = vi.fn();
	class MockS3Client {
		putObject = putObjectMock;
		headObject = headObjectMock;
		deleteObject = deleteObjectMock;
		listObjects = listObjectsMock;
		constructor(_config: unknown) {
			// ignore — test provides the mock fns at module scope
		}
	}
	class S3ErrorClass extends Error {
		constructor(msg: string, readonly status: number, readonly code: string) {
			super(msg);
			this.name = "S3Error";
		}
	}
	return { putObjectMock, headObjectMock, deleteObjectMock, listObjectsMock, MockS3Client, S3ErrorClass };
});

vi.mock("@/lib/storage/offsite/s3-client", () => ({
	S3Client: MockS3Client,
	S3Error: S3ErrorClass,
}));

import { prisma } from "@/lib/db";
import { getSetting } from "@/lib/settings/service";

import { uploadBackupToOffsite } from "../offsite-uploader";

const mockPrisma = prisma as unknown as {
	backupRecord: {
		findUnique: ReturnType<typeof vi.fn>;
		update: ReturnType<typeof vi.fn>;
	};
};
const mockGetSetting = getSetting as unknown as ReturnType<typeof vi.fn>;

const baseConfig = {
	enabled: true,
	provider: "minio" as const,
	endpoint: "https://minio.local",
	region: "us-east-1",
	bucket: "backups",
	accessKeyId: "AKIA",
	secretAccessKey: "secret",
	pathPrefix: "vcontrolhub-backups/",
	dailyWindowHour: 3,
	retentionDays: 30,
	failureAlertRecipient: "",
};

const baseRecord = {
	id: "rec-1",
	type: "DATABASE",
	status: "COMPLETED",
	filePath: "backups/2026-06-17/rec-1.sql",
	fileSize: "1024",
	note: null,
	errorMessage: null,
	createdBy: null,
	createdAt: new Date("2026-06-17T10:00:00Z"),
	updatedAt: new Date("2026-06-17T10:00:00Z"),
	completedAt: new Date("2026-06-17T10:00:00Z"),
	offsiteKey: null,
	offsiteUploadedAt: null,
	offsiteSize: null,
};

beforeEach(() => {
	loadConfigMock.mockReset();
	validateForUseMock.mockReset();
	validateForUseMock.mockReturnValue([]);
	putObjectMock.mockReset();
	headObjectMock.mockReset();
	deleteObjectMock.mockReset();
	listObjectsMock.mockReset();
	mockGetSetting.mockReset();
	mockGetSetting.mockResolvedValue("true");
	mockPrisma.backupRecord.findUnique.mockReset();
	mockPrisma.backupRecord.update.mockReset();
	mockPrisma.backupRecord.update.mockResolvedValue({ ...baseRecord });
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("uploadBackupToOffsite", () => {
	it("offsite disabled → ok=true skipped=offsite_disabled", async () => {
		loadConfigMock.mockResolvedValue({ ...baseConfig, enabled: false });
		const result = await uploadBackupToOffsite({ backupId: "rec-1" });
		expect(result.ok).toBe(true);
		if (result.ok && result.skipped) {
			expect(result.reason).toBe("offsite_disabled");
		} else {
			expect.fail("expected skipped result");
		}
	});

	it("config invalid (缺 endpoint) → ok=true skipped=config_invalid + issues", async () => {
		loadConfigMock.mockResolvedValue(baseConfig);
		validateForUseMock.mockReturnValue(["endpoint 未配置"]);
		const result = await uploadBackupToOffsite({ backupId: "rec-1" });
		expect(result.ok).toBe(true);
		if (result.ok && result.skipped) {
			expect(result.reason).toBe("config_invalid");
			expect(result.issues).toContain("endpoint 未配置");
		} else {
			expect.fail("expected skipped result");
		}
	});

	it("backup record 不存在 → ok=false code=BackupNotFound", async () => {
		loadConfigMock.mockResolvedValue(baseConfig);
		mockPrisma.backupRecord.findUnique.mockResolvedValue(null);
		const result = await uploadBackupToOffsite({ backupId: "missing" });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("BackupNotFound");
		}
	});

	it("backup record status 不是 COMPLETED → skipped=backup_not_completed", async () => {
		loadConfigMock.mockResolvedValue(baseConfig);
		mockPrisma.backupRecord.findUnique.mockResolvedValue({ ...baseRecord, status: "RUNNING" });
		const result = await uploadBackupToOffsite({ backupId: "rec-1" });
		expect(result.ok).toBe(true);
		if (result.ok && result.skipped) {
			expect(result.reason).toBe("backup_not_completed");
		} else {
			expect.fail("expected skipped result");
		}
	});

	it("happy path: 上传成功 → key 含 backupId, etag 写回, prisma.update 调一次", async () => {
		loadConfigMock.mockResolvedValue(baseConfig);
		// 用真 backup 文件路径: 临时建一个 .sql 让 fs.readFile 成功
		const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const dir = await mkdtemp("/tmp/55a-test-");
		try {
			// resolveBackupPath(projectRoot, filePath) → join(projectRoot, "backups", filePath)
			// 所以 filePath 只能是 "test.sql", 文件放在 dir/backups/test.sql
			await mkdir(join(dir, "backups"));
			const relPath = "test.sql";
			const fullPath = join(dir, "backups", relPath);
			await writeFile(fullPath, "SELECT 1;\n".repeat(200));
			mockPrisma.backupRecord.findUnique.mockResolvedValue({
				...baseRecord,
				filePath: relPath,
			});
			putObjectMock.mockResolvedValue({ etag: "etag-abc" });
			const result = await uploadBackupToOffsite({ backupId: "rec-1", projectRoot: dir });
			expect(result.ok).toBe(true);
			if (result.ok && !result.skipped) {
				expect(result.etag).toBe("etag-abc");
				expect(result.key).toContain("rec-1");
				expect(result.key).toMatch(/\.gz$/);
				expect(result.compressed).toBe(true);
				expect(result.compressedSize).toBeGreaterThan(0);
				expect(result.originalSize).toBeGreaterThan(result.compressedSize);
				expect(mockPrisma.backupRecord.update).toHaveBeenCalledTimes(1);
				const updateArg = mockPrisma.backupRecord.update.mock.calls[0]?.[0];
				expect(updateArg?.data?.offsiteKey).toContain("rec-1");
				expect(updateArg?.data?.offsiteSize).toBeDefined();
			} else {
				expect.fail("expected ok=true not skipped");
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("S3 PUT 抛 S3Error → ok=false code 透传, errorMessage 写回 record (前缀 [offsite-upload])", async () => {
		loadConfigMock.mockResolvedValue(baseConfig);
		mockPrisma.backupRecord.findUnique.mockResolvedValue({
			...baseRecord,
			filePath: "test.sql",
		});
		const S3ErrorMock = (await import("@/lib/storage/offsite/s3-client")).S3Error;
		putObjectMock.mockRejectedValue(new (S3ErrorMock as any)("bucket not found", 404, "NoSuchBucket"));
		const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const dir = await mkdtemp("/tmp/55a-test-");
		try {
			await mkdir(join(dir, "backups"));
			await writeFile(join(dir, "backups/test.sql"), "x".repeat(2000));
			const result = await uploadBackupToOffsite({ backupId: "rec-1", projectRoot: dir });
			expect(result.ok).toBe(false);
			if (!result.ok) {
				expect(result.code).toBe("NoSuchBucket");
				expect(result.error).toContain("bucket not found");
			}
			// prisma.update 应被调 1 次 (写错误进 errorMessage)
			expect(mockPrisma.backupRecord.update).toHaveBeenCalledTimes(1);
			const updateArg = mockPrisma.backupRecord.update.mock.calls[0]?.[0];
			expect(updateArg?.data?.errorMessage).toMatch(/^\[offsite-upload\] NoSuchBucket:/);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});

	it("offsite.compress=false → 不压缩, ext 为空, contentType=octet-stream", async () => {
		loadConfigMock.mockResolvedValue(baseConfig);
		mockPrisma.backupRecord.findUnique.mockResolvedValue({
			...baseRecord,
			filePath: "test.sql",
		});
		mockGetSetting.mockResolvedValue("false");
		putObjectMock.mockResolvedValue({ etag: "etag-raw" });
		const { mkdtemp, writeFile, rm, mkdir } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const dir = await mkdtemp("/tmp/55a-test-");
		try {
			await mkdir(join(dir, "backups"));
			await writeFile(join(dir, "backups/test.sql"), "raw content");
			const result = await uploadBackupToOffsite({ backupId: "rec-1", projectRoot: dir });
			expect(result.ok).toBe(true);
			if (result.ok && !result.skipped) {
				expect(result.compressed).toBe(false);
				expect(result.key).not.toMatch(/\.gz$/);
				expect(result.originalSize).toBe(result.compressedSize);
				expect(result.ratio).toBe(1);
				const putCall = putObjectMock.mock.calls[0];
				expect(putCall?.[2]).toBe("application/octet-stream");
			} else {
				expect.fail("expected ok=true not skipped");
			}
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
