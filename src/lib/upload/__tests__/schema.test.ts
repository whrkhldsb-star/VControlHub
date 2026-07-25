import { describe, expect, it } from "vitest";

import { initMediaUploadSchema, initStorageUploadSchema } from "@/lib/upload/schema";

describe("upload init schemas relativePath guards", () => {
	it("normalizes media directory paths and rejects traversal", () => {
		const ok = initMediaUploadSchema.safeParse({
			filename: "a.png",
			mimeType: "image/png",
			totalSize: 12,
			relativePath: "gallery/docs",
		});
		expect(ok.success).toBe(true);
		if (ok.success) expect(ok.data.relativePath).toBe("gallery/docs");

		expect(
			initMediaUploadSchema.safeParse({
				filename: "a.png",
				mimeType: "image/png",
				totalSize: 12,
				relativePath: "../etc",
			}).success,
		).toBe(false);
		expect(
			initMediaUploadSchema.safeParse({
				filename: "a.png",
				mimeType: "image/png",
				totalSize: 12,
				relativePath: "/abs",
			}).success,
		).toBe(false);
	});

	it("normalizes storage file paths and rejects traversal", () => {
		const ok = initStorageUploadSchema.safeParse({
			filename: "a.bin",
			mimeType: "application/octet-stream",
			totalSize: 12,
			storageNodeId: "node_1",
			relativePath: "team-a/docs/file.bin",
		});
		expect(ok.success).toBe(true);
		if (ok.success) expect(ok.data.relativePath).toBe("team-a/docs/file.bin");

		expect(
			initStorageUploadSchema.safeParse({
				filename: "a.bin",
				mimeType: "application/octet-stream",
				totalSize: 12,
				storageNodeId: "node_1",
				relativePath: "team-a/../secret.bin",
			}).success,
		).toBe(false);
	});
});
