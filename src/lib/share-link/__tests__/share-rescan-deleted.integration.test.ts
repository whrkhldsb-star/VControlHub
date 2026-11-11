// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { closeAdvisoryLockPoolForTests } from "@/lib/concurrency/advisory-lock";
import { syncLocalDirectoryEntries } from "@/lib/storage/local-sync";
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

	it("drops files that were removed from disk, down to an empty folder", async () => {
		const share = { entryType: "DIRECTORY", path: "shared", storageNodeId: id, storageNode: { basePath, driver: "LOCAL" } };
		await unlink(path.join(basePath, "shared", "kept.txt"));
		expect((await listShareDirectoryFiles(share)).map((file) => file.relativePath)).toEqual(["shared/new.txt"]);

		await unlink(path.join(basePath, "shared", "new.txt"));
		await unlink(path.join(basePath, "shared", "binned.txt"));
		expect(await listShareDirectoryFiles(share)).toEqual([]);
		// The folder itself and its siblings outside it are untouched.
		const folder = await prisma.fileEntry.findUniqueOrThrow({ where: { storageNodeId_relativePath: { storageNodeId: id, relativePath: "shared" } } });
		expect(folder.isDeleted).toBe(false);
	});

	it("leaves an unchanged file's modified time alone when the share page is opened (B2-1)", async () => {
		// Every view used to rewrite each live row, moving updatedAt (the
		// listing's modified time, WebDAV Last-Modified/ETag) to the visit.
		await mkdir(path.join(basePath, "steady"));
		await writeFile(path.join(basePath, "steady", "same.txt"), "same");
		const share = { entryType: "DIRECTORY", path: "steady", storageNodeId: id, storageNode: { basePath, driver: "LOCAL" } };
		await listShareDirectoryFiles(share);
		const where = { storageNodeId_relativePath: { storageNodeId: id, relativePath: "steady/same.txt" } };
		const earlier = new Date("2026-01-01T00:00:00Z");
		await prisma.fileEntry.update({ where, data: { updatedAt: earlier } });
		await listShareDirectoryFiles(share);
		expect((await prisma.fileEntry.findUniqueOrThrow({ where })).updatedAt).toEqual(earlier);
		// A real change is still picked up.
		await writeFile(path.join(basePath, "steady", "same.txt"), "now longer");
		await listShareDirectoryFiles(share);
		const changed = await prisma.fileEntry.findUniqueOrThrow({ where });
		expect(changed.size).toBe(BigInt(10));
		expect(changed.updatedAt.getTime()).toBeGreaterThan(earlier.getTime());
	});

	it("agrees with the file manager about a file of unknown type", async () => {
		// The file manager indexes "data.bin" without a type; the share page's own rescan gave it
		// "application/octet-stream". Each view of one after the other rewrote the row, so its modified time (the
		// WebDAV Last-Modified and ETag) moved although nothing had changed.
		await mkdir(path.join(basePath, "mixed"));
		await writeFile(path.join(basePath, "mixed", "data.bin"), "bytes");
		const share = { entryType: "DIRECTORY", path: "mixed", storageNodeId: id, storageNode: { basePath, driver: "LOCAL" } };
		const fileManagerView = () => syncLocalDirectoryEntries({ node: { id, name: id, driver: "LOCAL", basePath }, relativePath: "mixed" });
		await fileManagerView();
		const where = { storageNodeId_relativePath: { storageNodeId: id, relativePath: "mixed/data.bin" } };
		const earlier = new Date("2026-01-01T00:00:00Z");
		await prisma.fileEntry.update({ where, data: { updatedAt: earlier } });
		expect((await listShareDirectoryFiles(share)).map((file) => file.relativePath)).toEqual(["mixed/data.bin"]);
		expect((await prisma.fileEntry.findUniqueOrThrow({ where })).updatedAt).toEqual(earlier);
		await fileManagerView();
		expect((await prisma.fileEntry.findUniqueOrThrow({ where })).updatedAt).toEqual(earlier);
	});

	it("keeps the index when the folder cannot be read", async () => {
		await prisma.fileEntry.create({ data: { storageNodeId: id, relativePath: "missing/a.txt", name: "a.txt", entryType: "FILE", size: BigInt(1), updatedAt: new Date(Date.now() - 60_000) } });
		await listShareDirectoryFiles({ entryType: "DIRECTORY", path: "missing", storageNodeId: id, storageNode: { basePath, driver: "LOCAL" } });
		const row = await prisma.fileEntry.findUniqueOrThrow({ where: { storageNodeId_relativePath: { storageNodeId: id, relativePath: "missing/a.txt" } } });
		expect(row.isDeleted).toBe(false);
	});
});
