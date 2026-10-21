import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({
	createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

let tempRoot: string;
let cacheRoot: string;
vi.mock("@/lib/media/thumbnail-cache", () => ({ thumbnailCacheRoot: () => cacheRoot }));

const { respondWithStorageThumbnail } = await import("../thumbnail-response");
const noSsh = { host: null, port: null, username: null, hostKeySha256: null, server: null };

describe("respondWithStorageThumbnail", () => {
	beforeEach(async () => {
		tempRoot = await mkdtemp(path.join(os.tmpdir(), "vch-thumb-"));
		cacheRoot = path.join(tempRoot, "cache");
		await mkdir(path.join(tempRoot, "pics"), { recursive: true });
	});
	afterEach(async () => {
		await rm(tempRoot, { recursive: true, force: true });
	});

	it("resizes a local image into a cached JPEG", async () => {
		await sharp({ create: { width: 1200, height: 800, channels: 3, background: "#4060a0" } }).png().toFile(path.join(tempRoot, "pics/big.png"));
		const input = { id: "file_1", updatedAt: new Date("2026-10-21T00:00:00Z"), relativePath: "pics/big.png", node: { ...noSsh, id: "node_1", driver: "LOCAL", basePath: tempRoot } };
		const first = await respondWithStorageThumbnail(input);
		expect(first.status).toBe(200);
		expect(first.headers.get("Content-Type")).toBe("image/jpeg");
		expect(first.headers.get("X-Thumbnail-Cache")).toBe("miss");
		const meta = await sharp(Buffer.from(await first.arrayBuffer())).metadata();
		expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(320);
		const second = await respondWithStorageThumbnail(input);
		expect(second.headers.get("X-Thumbnail-Cache")).toBe("hit");
	});

	it("answers an unreadable source with the placeholder tile by default", async () => {
		const response = await respondWithStorageThumbnail({ id: "file_2", relativePath: "pics/missing.png", node: { ...noSsh, id: "node_1", driver: "LOCAL", basePath: tempRoot } });
		expect(response.status).toBe(200);
		expect(response.headers.get("X-Thumbnail-Placeholder")).toBe("offline");
	});

	it("answers 503 instead when the caller draws its own fallback", async () => {
		const missing = await respondWithStorageThumbnail({ id: "file_2", relativePath: "pics/missing.png", node: { ...noSsh, id: "node_1", driver: "LOCAL", basePath: tempRoot }, placeholder: false });
		expect(missing.status).toBe(503);
		const webdav = await respondWithStorageThumbnail({ id: "file_3", relativePath: "a.png", node: { ...noSsh, id: "node_2", driver: "WEBDAV", basePath: "/" }, placeholder: false });
		expect(webdav.status).toBe(503);
	});
});
