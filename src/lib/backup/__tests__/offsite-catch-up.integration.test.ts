// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const uploadedKeys: string[] = [];

vi.mock("@/lib/storage/offsite/schema", () => ({
	loadOffsiteConfig: async () => ({
		enabled: true,
		provider: "s3",
		endpoint: "https://s3.example.test",
		region: "us-east-1",
		bucket: "backups",
		accessKeyId: "key",
		secretAccessKey: "secret",
		pathPrefix: "catch-up-test/",
		dailyWindowHour: 3,
		retentionDays: 30,
		failureAlertRecipient: null,
	}),
	validateOffsiteConfigForUse: () => [],
}));
vi.mock("@/lib/storage/offsite/s3-client", () => ({
	S3Error: class S3Error extends Error {},
	S3Client: class {
		async putObject(key: string) {
			uploadedKeys.push(key);
			return { etag: "etag" };
		}
		async putFile(key: string) {
			uploadedKeys.push(key);
			return { etag: "etag" };
		}
	},
}));
vi.mock("@/lib/settings/service", () => ({ getSetting: async () => "false" }));
vi.mock("@/lib/notification/email", () => ({ sendEmail: async () => undefined }));

import { prisma } from "@/lib/db";
import { retryPendingOffsiteUploads } from "../offsite-uploader";

/**
 * The daily catch-up walks every completed backup that has no offsite copy
 * yet, a hundred at a time, and each upload takes its row out of that set.
 * Every pending backup must be uploaded in one run, also across pages.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("offsite catch-up across pages (PostgreSQL)", () => {
	const prefix = `offcatch-${randomUUID().slice(0, 8)}`;
	const total = 205;
	let root = "";
	let previousBackupDir: string | undefined;
	// Rows of other tests in the same database are not this test's to upload.
	let foreign: string[] = [];

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		root = await mkdtemp(join(tmpdir(), "vch-offsite-catch-up-"));
		previousBackupDir = process.env.BACKUP_DIR;
		process.env.BACKUP_DIR = root;
		await mkdir(join(root, "backups"));
		foreign = (await prisma.backupRecord.findMany({ where: { status: "COMPLETED", offsiteKey: null }, select: { id: true } })).map((row) => row.id);
		await prisma.backupRecord.updateMany({ where: { id: { in: foreign } }, data: { offsiteKey: `${prefix}-parked` } });
		const started = Date.now() - total * 1000;
		for (let index = 0; index < total; index += 1) {
			await writeFile(join(root, "backups", `${prefix}-${index}.sql.gz`), `backup ${index}`);
		}
		await prisma.backupRecord.createMany({
			data: Array.from({ length: total }, (_, index) => ({
				id: `${prefix}-${String(index).padStart(3, "0")}`,
				type: "DATABASE",
				status: "COMPLETED",
				filePath: `backups/${prefix}-${index}.sql.gz`,
				createdAt: new Date(started + index * 1000),
			})),
		});
	});
	afterAll(async () => {
		await prisma.backupRecord.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.backupRecord.updateMany({ where: { id: { in: foreign }, offsiteKey: `${prefix}-parked` }, data: { offsiteKey: null } });
		await prisma.$disconnect();
		if (previousBackupDir === undefined) delete process.env.BACKUP_DIR;
		else process.env.BACKUP_DIR = previousBackupDir;
		await rm(root, { recursive: true, force: true });
	});

	it("uploads every pending backup in one run, leaving none behind at a page boundary", async () => {
		const result = await retryPendingOffsiteUploads({ projectRoot: root });

		expect(result).toMatchObject({ observed: total, uploaded: total, failed: 0, skipped: 0 });
		expect(new Set(uploadedKeys).size).toBe(total);
		expect(await prisma.backupRecord.count({ where: { id: { startsWith: prefix }, offsiteKey: null } })).toBe(0);
	});
});
