import { beforeEach, describe, expect, it, vi } from "vitest";

const findMany = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", () => ({ prisma: { fileEntry: { findMany } } }));

const { assertNotRecycled, normalizeIndexedPath, recycledAround } = await import("../archive-access");

describe("recycle-bin checks on unnormalized paths", () => {
	beforeEach(() => {
		findMany.mockReset();
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
		findMany.mockResolvedValue([{ relativePath: "dir/trashed.zip" }]);
		await expect(assertNotRecycled("node_1", "dir//trashed.zip")).rejects.toMatchObject({ name: "NotFoundError" });
	});
});
