// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { indexDownloadedFileEntry } from "@/lib/downloads/helpers";
import { syncLocalDirectoryEntries } from "../local-sync";

/**
 * A file entry's checksum is recorded by the paths that hash the content (a chunked upload, a version restore, the
 * image bed's storage copy). A path that replaces the content without hashing it used to leave that checksum on the
 * row, where the API went on reporting it for bytes it no longer described.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("file entry checksum after the content changed (PostgreSQL)", () => {
	const nodeId = `sum-${randomUUID().slice(0, 8)}`;
	const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");
	let root = "";

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		root = await mkdtemp(path.join(tmpdir(), "vch-checksum-"));
		await prisma.storageNode.create({ data: { id: nodeId, name: nodeId, driver: "LOCAL", basePath: root } });
	}, 30_000);
	afterAll(async () => {
		await prisma.storageNode.deleteMany({ where: { id: nodeId } });
		await prisma.$disconnect();
		if (root) await rm(root, { recursive: true, force: true });
	});

	const indexWithChecksum = async (name: string, content: string) => {
		await writeFile(path.join(root, name), content);
		await prisma.fileEntry.create({
			data: { storageNodeId: nodeId, relativePath: name, name, entryType: "FILE", mimeType: "text/plain", size: BigInt(content.length), checksumSha256: sha256(content) },
		});
	};
	const row = (name: string) => prisma.fileEntry.findFirstOrThrow({ where: { storageNodeId: nodeId, relativePath: name }, select: { size: true, checksumSha256: true } });

	it("drops the checksum when a sync finds the file at another size", async () => {
		await indexWithChecksum("report.txt", "first draft");
		await indexWithChecksum("untouched.txt", "same as ever");
		// Edited outside the application (SSH, another program).
		await writeFile(path.join(root, "report.txt"), "second draft, longer");

		const result = await syncLocalDirectoryEntries({ node: { id: nodeId, driver: "LOCAL", basePath: root } });

		expect(result.errors).toEqual([]);
		expect(await row("report.txt")).toEqual({ size: BigInt(20), checksumSha256: null });
		// Nothing says this one changed: its checksum stays.
		expect(await row("untouched.txt")).toEqual({ size: BigInt(12), checksumSha256: sha256("same as ever") });
	}, 30_000);

	it("drops the checksum when a finished download replaces the file", async () => {
		await indexWithChecksum("image.iso", "old image");

		await indexDownloadedFileEntry({ storageNode: { id: nodeId, basePath: root }, targetPath: root, fileName: "image.iso", size: 4096 });

		expect(await row("image.iso")).toEqual({ size: BigInt(4096), checksumSha256: null });
	}, 30_000);
});
