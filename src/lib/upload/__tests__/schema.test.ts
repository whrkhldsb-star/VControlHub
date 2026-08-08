import { describe, expect, it } from "vitest";

import { initMediaUploadSchema, initStorageUploadSchema } from "@/lib/upload/schema";
import { MAX_IMAGE_UPLOAD_BYTES, MAX_TOTAL_SIZE } from "@/lib/upload/types";

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

	it("caps decoded image uploads below ordinary storage uploads", () => {
		expect(
			initMediaUploadSchema.safeParse({
				filename: "large.png",
				mimeType: "image/png",
				totalSize: MAX_IMAGE_UPLOAD_BYTES + 1,
			}).success,
		).toBe(false);

		expect(
			initStorageUploadSchema.safeParse({
				filename: "large.bin",
				mimeType: "application/octet-stream",
				totalSize: MAX_TOTAL_SIZE,
				storageNodeId: "node_1",
				relativePath: "large.bin",
			}).success,
		).toBe(true);
	});
});
