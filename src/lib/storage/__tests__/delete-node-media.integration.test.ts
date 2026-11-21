// @vitest-environment node
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

	it.each(["new file", "promotion", "restore"] as const)("rechecks a concurrent %s under database locks", async change => {
		const { deleteStorageNode } = await import("../service-nodes");
		const id = `${nodeId}-${change.replace(" ", "-")}`;
		await prisma.storageNode.create({ data: { id, name: id, driver: "LOCAL", basePath: versionDir } });
		if (change === "restore") {
			await prisma.fileEntry.create({ data: { id: `${id}-file`, name: "file", relativePath: "file", storageNodeId: id, entryType: "FILE", isDeleted: true } });
		}
		let signalWrite!: () => void;
		let allowCommit!: () => void;
		const wrote = new Promise<void>(resolve => { signalWrite = resolve; });
		const commit = new Promise<void>(resolve => { allowCommit = resolve; });
		const writer = prisma.$transaction(async tx => {
			if (change === "promotion") await tx.storageNode.update({ where: { id }, data: { isDefault: true } });
			else if (change === "restore") await tx.fileEntry.update({ where: { id: `${id}-file` }, data: { isDeleted: false } });
			else await tx.fileEntry.create({ data: { name: "file", relativePath: "file", storageNodeId: id, entryType: "FILE" } });
			signalWrite();
			await commit;
		});
		try {
			await Promise.race([wrote, writer]);
			const deleting = deleteStorageNode(id);
			const verdict = expect(deleting).rejects.toMatchObject({ name: "BusinessError" });
			try {
				await vi.waitFor(async () => {
					const waiting = await prisma.$queryRaw<{ locked: boolean }[]>`
						SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database()
							AND wait_event_type = 'Lock' AND (query LIKE '%"StorageNode"%' OR query LIKE '%"file_entries"%')) AS locked`;
					expect(waiting[0]?.locked).toBe(true);
				}, { timeout: 3000 });
			} finally {
				allowCommit();
			}
			await writer;
			await verdict;
			expect(await prisma.storageNode.count({ where: { id } })).toBe(1);
		} finally {
			allowCommit();
			await writer;
			await prisma.storageNode.deleteMany({ where: { id } });
		}
	});

	it.each(["pair", "claim"] as const)("waits for a deleting Agent node before locking its file binding on %s", async operation => {
		const { getFileChannel, pairFileShare } = await import("../agent-file-queue");
		const id = `${nodeId}-${operation}`;
		const tokenHash = "ab".repeat(32);
		await prisma.server.create({ data: {
			id, name: id, host: id + ".test", username: "files", managementMode: "AGENT", agentTokenHash: tokenHash,
		} });
		let attempt: Promise<boolean> | undefined;
		try {
			await prisma.storageNode.create({ data: {
				id, name: id, driver: "AGENT", basePath: "/",
				agentFileShare: { create: { serverId: id, agentHash: tokenHash, tokenHash: id, seenAt: new Date() } },
			} });
			await prisma.$transaction(async tx => {
				const [owner] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid FROM "StorageNode" WHERE id = ${id} FOR UPDATE`;
				attempt = (operation === "pair"
					? pairFileShare(id, { userId: id, username: id, currentTeamId: null, roles: ["admin"], mustChangePassword: false })
					: getFileChannel(id)).then(() => true, () => false);
				await vi.waitFor(async () => {
					const [waiter] = await tx.$queryRaw<{ blocked: boolean }[]>`
						SELECT EXISTS (SELECT FROM pg_stat_activity WHERE ${owner!.pid}::int = ANY(pg_blocking_pids(pid))) AS blocked`;
					expect(waiter?.blocked).toBe(true);
				}, { timeout: 3000 });
				// Deletion can take its cascading lock even with a live pair/claim waiting.
				await tx.$queryRaw`SELECT id FROM agent_file_shares WHERE "storageNodeId" = ${id} FOR UPDATE NOWAIT`;
				await tx.storageNode.delete({ where: { id } });
			});
			await expect(attempt).resolves.toBe(false);
		} finally {
			await attempt;
			await prisma.storageNode.deleteMany({ where: { id } });
			await prisma.server.deleteMany({ where: { id } });
		}
	});

	it("deletes the node with its recycle-bin media rows and removes its version blobs", async () => {
		const { deleteStorageNode } = await import("@/lib/storage/service-nodes");

		await expect(deleteStorageNode(nodeId)).resolves.toEqual({ deleted: true });

		expect(await prisma.storageNode.count({ where: { id: nodeId } })).toBe(0);
		expect(await prisma.mediaItem.count({ where: { storageNodeId: nodeId } })).toBe(0);
		await expect(stat(path.join(versionDir, nodeId))).rejects.toMatchObject({ code: "ENOENT" });
	});
});
