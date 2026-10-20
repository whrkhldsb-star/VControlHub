// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Deleting a storage node whose recycle bin still holds files: their media
 * rows (no foreign key to the file entry, so they stay until a rescan) hit
 * the node's RESTRICT key and the delete failed with a database error; the
 * version rows went by cascade but their blobs stayed on disk.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("deleting a storage node (PostgreSQL)", () => {
	const nodeId = `dn${randomUUID().replace(/-/g, "").slice(0, 20)}`;
	const entryId = `${nodeId}e`;
	let versionDir = "";
	let prisma: typeof import("@/lib/db").prisma;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		versionDir = await mkdtemp(path.join(tmpdir(), "vch-dn-versions-"));
		process.env.FILE_VERSION_DIR = versionDir;
		({ prisma } = await import("@/lib/db"));
		await prisma.storageNode.create({ data: { id: nodeId, name: nodeId, driver: "LOCAL", basePath: path.join(versionDir, "root"), isDefault: false } });
		await prisma.fileEntry.create({ data: { id: entryId, storageNodeId: nodeId, name: "clip.mp4", relativePath: "clip.mp4", entryType: "FILE", isDeleted: true } });
		await prisma.mediaItem.create({ data: { storageNodeId: nodeId, fileEntryId: entryId, name: "clip.mp4", relativePath: "clip.mp4", mimeType: "video/mp4", mediaType: "video" } });
		const blobRelativePath = `${nodeId}/${entryId}/v1.bin`;
		await prisma.fileVersion.create({ data: { fileEntryId: entryId, storageNodeId: nodeId, versionNumber: 1, name: "clip.mp4", relativePath: "clip.mp4", sizeBytes: BigInt(3), checksumSha256: "x", blobRelativePath, reason: "MANUAL" } });
		await mkdir(path.join(versionDir, nodeId, entryId), { recursive: true });
		await writeFile(path.join(versionDir, blobRelativePath), "old");
	});
	afterAll(async () => {
		await prisma.mediaItem.deleteMany({ where: { storageNodeId: nodeId } });
		await prisma.storageNode.deleteMany({ where: { id: nodeId } });
		await prisma.$disconnect();
		await rm(versionDir, { recursive: true, force: true });
	});

	it("deletes the node with its recycle-bin media rows and removes its version blobs", async () => {
		const { deleteStorageNode } = await import("@/lib/storage/service-nodes");

		await expect(deleteStorageNode(nodeId)).resolves.toEqual({ deleted: true });

		expect(await prisma.storageNode.count({ where: { id: nodeId } })).toBe(0);
		expect(await prisma.mediaItem.count({ where: { storageNodeId: nodeId } })).toBe(0);
		await expect(stat(path.join(versionDir, nodeId))).rejects.toMatchObject({ code: "ENOENT" });
	});
});
