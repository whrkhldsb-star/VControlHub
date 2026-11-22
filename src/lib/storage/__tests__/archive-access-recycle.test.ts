import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, findFirst, storageNodeFindUnique } = vi.hoisted(() => ({
	findMany: vi.fn(),
	findFirst: vi.fn(),
	storageNodeFindUnique: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
	prisma: {
		fileEntry: { findMany, findFirst },
		storageNode: { findUnique: storageNodeFindUnique },
	},
}));

const { assertNotRecycled, normalizeIndexedPath, recycledAround } = await import("../archive-access");

describe("recycle-bin checks on unnormalized paths", () => {
	beforeEach(() => {
		findMany.mockReset();
		findFirst.mockReset();
		storageNodeFindUnique.mockReset();
		storageNodeFindUnique.mockResolvedValue({
			driver: "SFTP",
			basePath: "/srv/data",
			server: { operatingSystem: "LINUX" },
		});
	});

	it("normalizes a path the way the file index stores it", () => {
		expect(normalizeIndexedPath("photos/")).toBe("photos");
		expect(normalizeIndexedPath("/dir//trashed.zip")).toBe("dir/trashed.zip");
		expect(normalizeIndexedPath("a/./b/")).toBe("a/b");
		expect(normalizeIndexedPath("./")).toBe("");
	});

	it("finds binned children of a folder named with a trailing slash", async () => {
		// "photos/" used to look for "photos//…" and miss them, so compress archived deleted files.
		findMany.mockResolvedValue([{ relativePath: "photos/trashed.jpg" }]);
		const result = await recycledAround("node_1", "photos/");
		expect(result).toEqual({ onPath: false, below: ["photos/trashed.jpg"] });
		const where = findMany.mock.calls[0]![0].where;
		expect(where.OR[0]).toEqual({ relativePath: { in: ["photos"] } });
	});

	it("treats a doubled slash as the same binned file", async () => {
		findFirst.mockResolvedValue({ id: "deleted-dir" });
		await expect(assertNotRecycled("node_1", "dir//trashed.zip")).rejects.toMatchObject({ name: "NotFoundError" });
		expect(findFirst.mock.calls[0]![0].where).toEqual({ storageNodeId: "node_1", isDeleted: true, relativePath: { in: ["dir", "dir/trashed.zip"] } });
		await expect(assertNotRecycled("node_1", "dir/new.txt", "write")).rejects.toMatchObject({ status: 409 });
	});

	it("falls back to case-insensitive recycle checks for Windows OpenSSH SFTP nodes when flags are omitted", async () => {
		storageNodeFindUnique.mockResolvedValueOnce({
			driver: "SFTP",
			basePath: "/data",
			server: { operatingSystem: "WINDOWS" },
		});
		findFirst.mockResolvedValueOnce({ id: "deleted-win" });
		await expect(assertNotRecycled("node_win", "secret/payroll.txt")).rejects.toMatchObject({ name: "NotFoundError" });
		expect(findFirst.mock.calls[0]![0].where).toEqual({
			storageNodeId: "node_win",
			isDeleted: true,
			relativePath: { in: ["secret", "secret/payroll.txt"], mode: "insensitive" },
		});

		storageNodeFindUnique.mockResolvedValueOnce({
			driver: "SFTP",
			basePath: "/C:/Files",
			server: null,
		});
		findFirst.mockResolvedValueOnce(null);
		await expect(assertNotRecycled("node_win_path", "secret/file.txt", "write", "SFTP")).resolves.toBeUndefined();
		expect(findFirst.mock.calls[1]![0].where).toEqual({
			storageNodeId: "node_win_path",
			isDeleted: true,
			relativePath: { in: ["secret", "secret/file.txt"], mode: "insensitive" },
		});
	});

	it("fails closed when the storage node lookup returns null and honors explicit args when passed", async () => {
		storageNodeFindUnique.mockResolvedValueOnce(null);
		findFirst.mockResolvedValueOnce({ id: "deleted-missing-node" });
		await expect(assertNotRecycled("node_missing", "Secret/File.txt")).rejects.toMatchObject({ name: "NotFoundError" });
		expect(findFirst.mock.calls[0]![0].where).toEqual({
			storageNodeId: "node_missing",
			isDeleted: true,
			relativePath: { in: ["Secret", "Secret/File.txt"], mode: "insensitive" },
		});

		storageNodeFindUnique.mockClear();
		findFirst.mockResolvedValueOnce(null);
		await expect(assertNotRecycled("node_linux", "Secret/File.txt", "read", "SFTP", false)).resolves.toBeUndefined();
		expect(storageNodeFindUnique).not.toHaveBeenCalled();
		expect(findFirst.mock.calls[1]![0].where).toEqual({
			storageNodeId: "node_linux",
			isDeleted: true,
			relativePath: { in: ["Secret", "Secret/File.txt"] },
		});

		findFirst.mockResolvedValueOnce({ id: "deleted-explicit-win" });
		await expect(assertNotRecycled("node_win", "secret/file.txt", "write", "SFTP", true)).rejects.toMatchObject({ status: 409 });
		expect(storageNodeFindUnique).not.toHaveBeenCalled();
		expect(findFirst.mock.calls[2]![0].where).toEqual({
			storageNodeId: "node_win",
			isDeleted: true,
			relativePath: { in: ["secret", "secret/file.txt"], mode: "insensitive" },
		});
	});
});
