// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { prepareBackupRecordRetry } from "../service-crud";
import { pruneOldBackupRecordsNow } from "../service-runtime";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("platform archive retention (PostgreSQL)", () => {
	const prefix = randomUUID();
	const teamId = prefix;
	let directory: string;
	const prune = () => pruneOldBackupRecordsNow({ teamId, olderThanDays: 1, keepLatestPerType: 0 });
	async function record(id: string, filePath: string, status = "FAILED") {
		return prisma.backupRecord.create({ data: {
			id: prefix + id, teamId, status, filePath, type: "FULL", createdAt: new Date("2024-01-01"),
		} });
	}

	beforeAll(async () => {
		const url = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) throw new Error("requires an isolated test database");
		directory = await mkdtemp(join(tmpdir(), "vch-retention-claim-"));
		vi.stubEnv("BACKUP_DIR", directory);
		await prisma.team.create({ data: { id: teamId, name: prefix, slug: prefix } });
	});
	afterAll(async () => {
		await prisma.backupRecord.deleteMany({ where: { teamId } });
		await prisma.team.deleteMany({ where: { id: teamId } });
		await prisma.$disconnect();
		vi.unstubAllEnvs();
		if (directory) await rm(directory, { recursive: true, force: true });
	});

	it("serializes a retry racing with cleanup without leaving a queued record missing its archive", async () => {
		const backup = await record("retry", "old.tar.gz");
		const file = join(directory, backup.filePath);
		await writeFile(file, "archive");
		const [retry, cleaning] = await Promise.allSettled([prepareBackupRecordRetry({ id: backup.id }), prune()]);
		if (cleaning.status === "rejected") throw cleaning.reason;
		if (retry.status === "fulfilled") {
			expect(cleaning.value.deletedRecords).toBe(0);
			expect((await prisma.backupRecord.findUniqueOrThrow({ where: { id: backup.id } })).status).toBe("PENDING");
			expect(await readFile(file, "utf8")).toBe("archive");
		} else {
			expect(cleaning.value.deletedRecords).toBe(1);
			expect(await prisma.backupRecord.findUnique({ where: { id: backup.id } })).toBeNull();
			await expect(stat(file)).rejects.toMatchObject({ code: "ENOENT" });
		}
	});

	it("resumes interrupted cleanup and unlinks a shared path only at the last reference", async () => {
		await record("a", " shared.tar.gz ", "PRUNING");
		await record("b", "shared.tar.gz", "VOIDED");
		await writeFile(join(directory, "shared.tar.gz"), "archive");
		const results = await Promise.all([prune(), prune()]);
		expect(results.flatMap((result) => result.fileErrors)).toEqual([]);
		expect(results.reduce((n, r) => n + r.deletedRecords, 0)).toBe(2);
		expect(results.reduce((n, r) => n + r.filesDeleted, 0)).toBe(1);
		await expect(stat(join(directory, "shared.tar.gz"))).rejects.toMatchObject({ code: "ENOENT" });
	});
});
