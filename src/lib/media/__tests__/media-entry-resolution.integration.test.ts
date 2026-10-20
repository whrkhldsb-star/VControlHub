// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { getMediaItem } from "../service";

/**
 * The media library is re-indexed only by a scan. Opening an item used its
 * stored row as is: a recycled file kept playing, a renamed one 404ed, and a
 * file deleted for good stayed in the library.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("media items follow their file entry (PostgreSQL)", () => {
	const nodeId = `mr${randomUUID().replace(/-/g, "").slice(0, 20)}`;
	const entryId = `${nodeId}e`;
	let mediaId = "";

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.storageNode.create({ data: { id: nodeId, name: nodeId, driver: "LOCAL", basePath: "/tmp/vch-media-resolution", isDefault: false } });
		await prisma.fileEntry.create({ data: { id: entryId, storageNodeId: nodeId, name: "a.jpg", relativePath: "photos/a.jpg", entryType: "FILE" } });
		mediaId = (await prisma.mediaItem.create({ data: { storageNodeId: nodeId, fileEntryId: entryId, name: "a.jpg", relativePath: "photos/a.jpg", mimeType: "image/jpeg", mediaType: "image" } })).id;
	});
	afterAll(async () => {
		await prisma.mediaItem.deleteMany({ where: { storageNodeId: nodeId } });
		await prisma.storageNode.deleteMany({ where: { id: nodeId } });
		await prisma.$disconnect();
	});

	it("uses and stores the file's new path after a rename", async () => {
		await prisma.fileEntry.update({ where: { id: entryId }, data: { name: "b.jpg", relativePath: "archive/b.jpg" } });
		await expect(getMediaItem(mediaId, null, { includeCredentials: true })).resolves.toMatchObject({ name: "b.jpg", relativePath: "archive/b.jpg" });
		await expect(prisma.mediaItem.findUnique({ where: { id: mediaId } })).resolves.toMatchObject({ relativePath: "archive/b.jpg" });
	});

	it("hides an item whose file is in the recycle bin", async () => {
		await prisma.fileEntry.update({ where: { id: entryId }, data: { isDeleted: true } });
		await expect(getMediaItem(mediaId, null, { includeCredentials: true })).resolves.toBeNull();
		expect(await prisma.mediaItem.count({ where: { id: mediaId } })).toBe(1);
	});

	it("drops an item whose file was deleted for good", async () => {
		await prisma.fileEntry.delete({ where: { id: entryId } });
		await expect(getMediaItem(mediaId)).resolves.toBeNull();
		expect(await prisma.mediaItem.count({ where: { id: mediaId } })).toBe(0);
	});
});
