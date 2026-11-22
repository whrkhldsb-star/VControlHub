// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const uploadedKeys: string[] = [];
const remote = vi.hoisted(() => ({
	bucket: "backups",
	list: vi.fn(async () => ({ objects: [] as { key: string; size: number; lastModified: string }[] })),
	remove: vi.fn(async (_key: string, _version?: string) => "deleted"),
}));

vi.mock("@/lib/storage/offsite/schema", () => ({
	loadOffsiteConfig: async () => ({
		enabled: true,
		provider: "s3",
		endpoint: "https://s3.example.test",
		region: "us-east-1",
		bucket: remote.bucket,
		accessKeyId: "key",
		secretAccessKey: "secret",
		pathPrefix: "catch-up-test/",
		dailyWindowHour: 3,
		retentionDays: 30,
		failureAlertRecipient: null,
	}),
	validateOffsiteConfigForUse: () => [],
}));
vi.mock("@/lib/storage/offsite/s3-client", async (original) => ({
	...await original<typeof import("@/lib/storage/offsite/s3-client")>(),
	S3Error: class S3Error extends Error {},
	S3Client: class {
		listObjects = remote.list;
		deleteObject = remote.remove;
		async putObject(key: string) {
			uploadedKeys.push(key);
			return { etag: "etag", versionId: "version-a" };
		}
		async putFile(key: string) {
			uploadedKeys.push(key);
			return { etag: "etag", versionId: "version-a" };
		}
	},
}));
vi.mock("@/lib/settings/service", () => ({ getSetting: async () => "false" }));
vi.mock("@/lib/notification/email", () => ({ sendEmail: async () => undefined }));

import { prisma } from "@/lib/db";
import { pruneOffsiteObjects } from "../offsite-retention";
import { PLATFORM_RECEIPT_PREFIX, platformOffsiteDestination } from "../service-types";
import { retryPendingOffsiteUploads, uploadBackupToOffsite } from "../offsite-uploader";

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
		await prisma.setting.deleteMany({ where: { key: { startsWith: PLATFORM_RECEIPT_PREFIX + prefix } } });
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
	it("publishes once under concurrent delivery and persists the destination and returned version", async () => {
		const id = prefix + "-parallel";
		const filePath = "backups/" + id + ".sql.gz";
		await writeFile(join(root, filePath), "sample");
		await prisma.backupRecord.create({ data: { id, filePath, type: "DATABASE", status: "COMPLETED" } });
		const results = await Promise.all([1, 2].map(() => uploadBackupToOffsite({ backupId: id, projectRoot: root })));
		expect(results.filter((r) => r.ok && !r.skipped)).toHaveLength(1);
		expect(uploadedKeys.filter((key) => key.includes(id))).toHaveLength(1);
		const stored = await prisma.setting.findUniqueOrThrow({ where: { key: PLATFORM_RECEIPT_PREFIX + id } });
		expect(JSON.parse(stored.value)).toMatchObject({ versionId: "version-a", destination: platformOffsiteDestination({ endpoint: "https://s3.example.test", bucket: remote.bucket }) });
	});

	it("expires only the recorded destination and version and preserves unbound historical keys", async () => {
		remote.bucket = prefix;
		const destination = platformOffsiteDestination({ endpoint: "https://s3.example.test", bucket: remote.bucket });
		expect(platformOffsiteDestination({ endpoint: "https://S3.example.test:443/?legacy=1#saved", bucket: remote.bucket })).toBe(destination);
		const key = (suffix: string) => "catch-up-test/" + prefix + suffix;
		const rows = [
			{ suffix: "expired", key: key("same"), destination, versionId: "expired" },
			{ suffix: "foreign", key: key("same"), destination: "another bucket", versionId: "foreign" },
			{ suffix: "keep", key: key("newest"), destination, versionId: "keep" },
			{ suffix: "legacy", key: key("legacy"), destination: null, versionId: null },
		];
		for (const row of rows) {
			const id = prefix + row.suffix;
			await prisma.backupRecord.create({ data: { id, filePath: "archive", status: "COMPLETED", type: "FULL", offsiteKey: row.key, offsiteSize: "100" } });
			if (row.destination) await prisma.setting.create({ data: { key: PLATFORM_RECEIPT_PREFIX + id, value: JSON.stringify({
				destination: row.destination, key: row.key, type: "FULL", versionId: row.versionId,
				uploadedAt: row.suffix === "keep" ? "2022-02-01T00:00:00.000Z" : "2022-01-01T00:00:00.000Z",
			}) } });
		}
		remote.list.mockResolvedValue({ objects: rows.map((r) => ({ key: r.key, size: 100, lastModified: "2022-02-01T00:00:00.000Z" })) });
		try {
			expect(await pruneOffsiteObjects({ now: new Date("2023-01-01") })).toMatchObject({ deletedVersions: 1, errors: [] });
			expect(remote.remove.mock.calls).toEqual([[key("same"), "expired"]]);
			for (const row of rows) {
				const backup = await prisma.backupRecord.findUniqueOrThrow({ where: { id: prefix + row.suffix } });
				expect(backup.offsiteKey).toBe(row.suffix === "expired" ? null : row.key);
			}
		} finally {
			remote.bucket = "backups";
		}
	});

});
