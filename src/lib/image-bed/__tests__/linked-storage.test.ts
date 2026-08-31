import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `indexLinkedStorageImage`.
 *
 * The one property worth holding: this writes through `upsert` keyed on
 * `@@unique([storageNodeId, relativePath])` rather than a find-then-create. Two
 * concurrent uploads of the same path would otherwise race into a P2002, and the
 * loser's request fails even though its bytes landed. The module comment says
 * exactly that, so a refactor back to create-if-missing has to fail a test.
 *
 * `size` also has to become a BigInt: the column is BigInt and passing a JS
 * number is a Prisma type error at runtime.
 */
const mocks = vi.hoisted(() => ({ upsert: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { fileEntry: { upsert: mocks.upsert } } }));

import { indexLinkedStorageImage } from "../linked-storage";

const input = {
	storageNodeId: "node_1",
	relativePath: "images/2026/08/photo.png",
	originalName: "photo.png",
	mimeType: "image/png",
	size: 2048,
	checksum: "abc123",
};

describe("indexLinkedStorageImage", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.upsert.mockReset();
		mocks.upsert.mockResolvedValue({ id: "fe_1" });
	});

	it("upserts on the composite unique key rather than creating", async () => {
		// A find-then-create here loses a concurrent-upload race with P2002.
		await indexLinkedStorageImage(input);
		expect(mocks.upsert).toHaveBeenCalledTimes(1);
		const call = mocks.upsert.mock.calls[0]![0] as { where: unknown };
		expect(call.where).toEqual({
			storageNodeId_relativePath: { storageNodeId: "node_1", relativePath: "images/2026/08/photo.png" },
		});
	});

	it("stores the size as a BigInt", async () => {
		await indexLinkedStorageImage(input);
		const call = mocks.upsert.mock.calls[0]![0] as { create: { size: unknown } };
		expect(call.create.size).toBe(BigInt(2048));
	});

	it("writes the same field set on create and update", async () => {
		// Divergence here means a re-uploaded image keeps a stale mimeType or size.
		await indexLinkedStorageImage(input);
		const call = mocks.upsert.mock.calls[0]![0] as { create: Record<string, unknown>; update: Record<string, unknown> };
		for (const key of Object.keys(call.update)) {
			expect(call.create[key]).toEqual(call.update[key]);
		}
		expect(call.create.storageNodeId).toBe("node_1");
		expect(call.create.relativePath).toBe("images/2026/08/photo.png");
	});

	it("revives a soft-deleted row by clearing isDeleted", async () => {
		// Re-uploading to a path that is in the recycle bin must produce a live
		// entry, not a row that is indexed but invisible.
		await indexLinkedStorageImage(input);
		const call = mocks.upsert.mock.calls[0]![0] as { update: { isDeleted: unknown } };
		expect(call.update.isDeleted).toBe(false);
	});

	it("falls back to the path basename when originalName is empty", async () => {
		await indexLinkedStorageImage({ ...input, originalName: "" });
		const call = mocks.upsert.mock.calls[0]![0] as { create: { name: string } };
		expect(call.create.name).toBe("photo.png");
	});

	it("uses posix basename semantics so a backslash stays part of the name", async () => {
		// Remote-style paths are posix; treating "\" as a separator here would
		// disagree with how the path was stored.
		await indexLinkedStorageImage({ ...input, originalName: "", relativePath: "images/a\\b.png" });
		const call = mocks.upsert.mock.calls[0]![0] as { create: { name: string } };
		expect(call.create.name).toBe("a\\b.png");
	});

	it("marks the entry as a FILE with the supplied checksum", async () => {
		await indexLinkedStorageImage(input);
		const call = mocks.upsert.mock.calls[0]![0] as { create: Record<string, unknown> };
		expect(call.create.entryType).toBe("FILE");
		expect(call.create.checksumSha256).toBe("abc123");
		expect(call.create.mimeType).toBe("image/png");
	});
});
