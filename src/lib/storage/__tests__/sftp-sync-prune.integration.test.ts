// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const listRemoteDirectoryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/ssh/client", () => ({
	resolveRemoteRealPath: vi.fn(async ({ remotePath }: { remotePath: string }) => remotePath),
	listRemoteDirectory: listRemoteDirectoryMock,
}));
vi.mock("@/lib/ssh/ssh-key-crypto", async () => (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({
	decryptServerPassword: (value: string) => value,
	decryptSshPrivateKey: (value: string) => value,
}));

import { prisma } from "@/lib/db";
import { syncSftpDirectoryEntries } from "../sftp-sync";

/**
 * The prune after a directory listing, against the real index: it reads the directory's own children (it used to
 * page through every live row below the directory) and soft-deletes those the remote listing no longer has.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("SFTP sync prune (PostgreSQL)", () => {
	const nodeId = `prune-${randomUUID().slice(0, 8)}`;
	const node = {
		id: nodeId, name: nodeId, driver: "SFTP", basePath: "/data/files", host: null, port: null, username: null, hostKeySha256: null,
		server: { id: "srv", host: "203.0.113.20", port: 22, username: "deploy", connectionType: "PASSWORD", managementMode: "DIRECT", operatingSystem: "LINUX" as const, password: "secret", hostKeySha256: null, sshKey: null },
	} as const;
	const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
	const file = (relativePath: string, extra: { isDeleted?: boolean; updatedAt?: Date } = {}) => ({
		storageNodeId: nodeId, relativePath, name: relativePath.split("/").at(-1)!, entryType: "FILE" as const, mimeType: "text/plain", size: BigInt(1),
		isDeleted: extra.isDeleted ?? false, updatedAt: extra.updatedAt ?? yesterday,
	});

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.storageNode.create({ data: { id: nodeId, name: nodeId, driver: "SFTP", basePath: "/data/files", host: "203.0.113.20", port: 22, username: "deploy" } });
		await prisma.fileEntry.createMany({
			data: [
				file("docs/kept.txt"),
				file("docs/gone.txt"),
				// A name with LIKE wildcards and one that only shares the directory's prefix.
				file("docs/100%_done.txt"),
				file("docs-archive/other.txt"),
				// Below the directory, not its own child: another listing's business.
				file("docs/sub/deep.txt"),
				{ ...file("docs/sub"), entryType: "DIRECTORY" as const, mimeType: "inode/directory", size: null },
				// Already in the recycle bin, and one written after the listing started.
				file("docs/binned.txt", { isDeleted: true }),
				file("docs/just-uploaded.txt", { updatedAt: new Date(Date.now() + 60_000) }),
				file("top-level.txt"),
			],
		});
	}, 30_000);
	afterAll(async () => {
		await prisma.storageNode.deleteMany({ where: { id: nodeId } });
		await prisma.$disconnect();
	});

	const live = async () => (await prisma.fileEntry.findMany({ where: { storageNodeId: nodeId, isDeleted: false }, select: { relativePath: true }, orderBy: { relativePath: "asc" } })).map((row) => row.relativePath);

	it("soft-deletes the directory's own children that the remote listing no longer has", async () => {
		listRemoteDirectoryMock.mockResolvedValueOnce([
			{ name: "kept.txt", longname: "kept.txt", type: "file", size: 1, modifyTime: 1, accessTime: 1 },
			{ name: "sub", longname: "sub", type: "directory", size: 0, modifyTime: 1, accessTime: 1 },
		]);
		const result = await syncSftpDirectoryEntries({ node, remotePath: "docs", recursive: false });
		expect(result.errors).toEqual([]);
		expect(result.deleted).toBe(2);
		expect(await live()).toEqual([
			"docs-archive/other.txt",
			"docs/just-uploaded.txt",
			"docs/kept.txt",
			"docs/sub",
			"docs/sub/deep.txt",
			"top-level.txt",
		]);
	}, 30_000);

	it("prunes the node root without touching anything deeper", async () => {
		listRemoteDirectoryMock.mockResolvedValueOnce([
			{ name: "docs", longname: "docs", type: "directory", size: 0, modifyTime: 1, accessTime: 1 },
			{ name: "docs-archive", longname: "docs-archive", type: "directory", size: 0, modifyTime: 1, accessTime: 1 },
		]);
		const result = await syncSftpDirectoryEntries({ node, recursive: false });
		expect(result.errors).toEqual([]);
		// top-level.txt is gone remotely; the two directories were not indexed yet and are created.
		expect(result).toMatchObject({ created: 2, deleted: 1 });
		expect(await live()).toEqual([
			"docs",
			"docs-archive",
			"docs-archive/other.txt",
			"docs/just-uploaded.txt",
			"docs/kept.txt",
			"docs/sub",
			"docs/sub/deep.txt",
		]);
	}, 30_000);
});
