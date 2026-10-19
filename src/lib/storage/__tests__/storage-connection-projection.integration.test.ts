// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { listRemoteDirectory } = vi.hoisted(() => ({ listRemoteDirectory: vi.fn(async () => []) }));
vi.mock("@/lib/ssh/client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/ssh/client")>()),
	listRemoteDirectory,
}));

import { prisma } from "@/lib/db";
import { getMediaItem, scanMediaFromFileEntries } from "@/lib/media/service";
import { getSftpNodeConnection } from "../sftp-node";
import { checkStorageNodeHealth } from "../service-nodes";
import { resolveStorageSshCredentials } from "../ssh-credentials";

/**
 * Every reader of a storage node resolves the same connection: media
 * playback and the health probe used to load fewer fields than file
 * operations, so they reached the server's host/user instead of the node's
 * own, and treated an Agent-managed server as one without credentials.
 * Real queries, real resolver; no network (the SSH listing is stubbed).
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("storage connection projections (PostgreSQL)", () => {
	const prefix = `proj-${randomUUID().slice(0, 8)}`;
	let nodeId = "";
	let serverId = "";

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		const server = await prisma.server.create({
			data: { name: prefix, host: "192.0.2.10", port: 22, username: "server-user", tags: [], managementMode: "AGENT", connectionType: "SSH_KEY" },
		});
		serverId = server.id;
		const node = await prisma.storageNode.create({
			data: { name: prefix, driver: "SFTP", basePath: "/data", serverId, host: "198.51.100.20", port: 2222, username: "storage-user" },
		});
		nodeId = node.id;
	});
	afterAll(async () => {
		await prisma.mediaItem.deleteMany({ where: { storageNodeId: nodeId } });
		await prisma.fileEntry.deleteMany({ where: { storageNodeId: nodeId } });
		await prisma.storageNode.deleteMany({ where: { id: nodeId } });
		await prisma.server.deleteMany({ where: { id: serverId } });
		await prisma.$disconnect();
	});

	it("media playback resolves the same target as file operations", async () => {
		const files = (await getSftpNodeConnection(nodeId)).credentials;
		expect(files).toMatchObject({ host: "198.51.100.20", port: 2222, username: "storage-user", agentServerId: serverId });

		const entry = await prisma.fileEntry.create({ data: { name: "a.mp4", entryType: "FILE", relativePath: "a.mp4", storageNodeId: nodeId, mimeType: "video/mp4" } });
		await scanMediaFromFileEntries();
		const media = await prisma.mediaItem.findFirstOrThrow({ where: { fileEntryId: entry.id } });
		const item = await getMediaItem(media.id, null, { includeCredentials: true });
		expect(resolveStorageSshCredentials(item!.storageNode as never)).toMatchObject({
			host: files.host, port: files.port, username: files.username, agentServerId: files.agentServerId,
		});
	});

	it("the health probe connects where file operations do", async () => {
		await checkStorageNodeHealth(nodeId);
		expect(listRemoteDirectory).toHaveBeenCalledWith(expect.objectContaining({ host: "198.51.100.20", port: 2222, username: "storage-user", agentServerId: serverId }));
		expect((await prisma.storageNode.findUniqueOrThrow({ where: { id: nodeId } })).healthStatus).toBe("HEALTHY");
	});

	it("a rescan drops media whose file is no longer media", async () => {
		const entry = await prisma.fileEntry.create({ data: { name: "photo.jpg", entryType: "FILE", relativePath: "photo.jpg", storageNodeId: nodeId, mimeType: "image/jpeg" } });
		await scanMediaFromFileEntries();
		expect(await prisma.mediaItem.count({ where: { fileEntryId: entry.id } })).toBe(1);
		// Renamed and rewritten as text: the same index row, no longer media.
		await prisma.fileEntry.update({ where: { id: entry.id }, data: { name: "note.txt", relativePath: "note.txt", mimeType: "text/plain; charset=utf-8" } });
		await scanMediaFromFileEntries();
		expect(await prisma.mediaItem.count({ where: { fileEntryId: entry.id } })).toBe(0);
	});
});
