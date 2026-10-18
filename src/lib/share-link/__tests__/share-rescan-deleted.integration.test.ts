// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { closeAdvisoryLockPoolForTests } from "@/lib/concurrency/advisory-lock";
import { listShareDirectoryFiles } from "../service";

/**
 * Soft delete only marks the index: a file in the recycle bin is still on
 * disk. Opening a share of its folder rescans the folder, and that rescan
 * must index new files without bringing the deleted one back to visitors.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("directory share rescan in PostgreSQL", () => {
	const id = `share-rescan-${randomUUID()}`;
	let basePath = "";
	let ready = false;
	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("Share rescan integration requires an isolated loopback audit/test database");
		}
		basePath = await mkdtemp(path.join(tmpdir(), "vch-share-rescan-"));
		await mkdir(path.join(basePath, "shared"));
		await writeFile(path.join(basePath, "shared", "binned.txt"), "deleted but still on disk");
		await writeFile(path.join(basePath, "shared", "kept.txt"), "kept");
		await writeFile(path.join(basePath, "shared", "new.txt"), "added outside the app");
		await prisma.storageNode.create({ data: { id, name: id, driver: "LOCAL", basePath } });
		await prisma.fileEntry.createMany({ data: [
			{ storageNodeId: id, relativePath: "shared", name: "shared", entryType: "DIRECTORY" },
			{ storageNodeId: id, relativePath: "shared/binned.txt", name: "binned.txt", entryType: "FILE", size: BigInt(1), isDeleted: true },
			{ storageNodeId: id, relativePath: "shared/kept.txt", name: "kept.txt", entryType: "FILE", size: BigInt(1) },
		] });
		ready = true;
	});
	afterAll(async () => {
		if (ready) await prisma.storageNode.delete({ where: { id } });
		if (basePath) await rm(basePath, { recursive: true, force: true });
		await closeAdvisoryLockPoolForTests();
		await prisma.$disconnect();
	});

	it("indexes new files but leaves a recycle-bin file deleted", async () => {
		const files = await listShareDirectoryFiles({ entryType: "DIRECTORY", path: "shared", storageNodeId: id, storageNode: { basePath, driver: "LOCAL" } });

		expect(files.map((file) => file.relativePath)).toEqual(["shared/kept.txt", "shared/new.txt"]);
		const binned = await prisma.fileEntry.findUniqueOrThrow({ where: { storageNodeId_relativePath: { storageNodeId: id, relativePath: "shared/binned.txt" } } });
		expect(binned).toMatchObject({ isDeleted: true, size: BigInt(1) });
		// The live entry's facts are refreshed from disk.
		expect(files.find((file) => file.relativePath === "shared/kept.txt")?.size).toBe(BigInt(4));
	});
});
