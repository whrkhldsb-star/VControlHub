import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { crc32, deflateSync } from "node:zlib";

import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({
	createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

const connectSshMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/ssh/client", () => ({
	connectSsh: connectSshMock,
	resolveRemoteRealPath: vi.fn(async ({ remotePath }: { remotePath: string }) => remotePath),
	RemoteDanglingLinkError: class RemoteDanglingLinkError extends Error {},
}));
vi.mock("@/lib/ssh/ssh-key-crypto", async () => (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({
	decryptServerPassword: (value: string) => value,
	decryptSshPrivateKey: (value: string) => value,
}));

/** A valid 8-bit greyscale PNG of one colour, Adam7-interlaced: a few kilobytes that decode to width × height bytes. */
function interlacedPng(width: number, height: number): Buffer {
	const chunk = (kind: string, data: Buffer) => {
		const body = Buffer.concat([Buffer.from(kind, "latin1"), data]);
		const out = Buffer.alloc(8 + data.length + 4);
		out.writeUInt32BE(data.length, 0);
		body.copy(out, 4);
		out.writeUInt32BE(crc32(body) >>> 0, 8 + data.length);
		return out;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header.set([8, 0, 0, 0, 1], 8); // bit depth 8, greyscale, deflate, adaptive filtering, Adam7
	const passes = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] as const;
	let rawLength = 0;
	for (const [x0, y0, dx, dy] of passes) {
		const columns = width > x0 ? Math.ceil((width - x0) / dx) : 0;
		const rows = height > y0 ? Math.ceil((height - y0) / dy) : 0;
		if (columns && rows) rawLength += rows * (1 + columns);
	}
	// Every byte zero: filter type "none" and black pixels.
	const data = deflateSync(Buffer.alloc(rawLength), { level: 1 });
	return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", data), chunk("IEND", Buffer.alloc(0))]);
}

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

	it("refuses an interlaced image past the pixel ceiling instead of decoding it", async () => {
		// An interlaced PNG, a progressive JPEG and a GIF are decoded whole in memory. Measured with the previous code:
		// an 800 KB interlaced PNG of 16000 x 16000 took the process to 848 MB for one thumbnail (a progressive JPEG
		// 804 MB, a GIF 1.15 GB), and a folder view asks for many at once.
		const bomb = interlacedPng(7500, 7500);
		expect(bomb.length).toBeLessThan(1_000_000);
		await writeFile(path.join(tempRoot, "pics/bomb.png"), bomb);
		const response = await respondWithStorageThumbnail({ id: "file_bomb", relativePath: "pics/bomb.png", node: { ...noSsh, id: "node_1", driver: "LOCAL", basePath: tempRoot } });
		expect(response.status).toBe(413);
	});

	it("still makes the thumbnail of a large photo that can be read as a stream", async () => {
		// A baseline JPEG is shrunk while it is read (72 MB for 256 megapixels): a 56-megapixel camera photo keeps
		// its thumbnail.
		await sharp({ create: { width: 8000, height: 7000, channels: 3, background: "#4060a0" } }).jpeg({ progressive: false, mozjpeg: false }).toFile(path.join(tempRoot, "pics/large-photo.jpg"));
		const response = await respondWithStorageThumbnail({ id: "file_large", relativePath: "pics/large-photo.jpg", node: { ...noSsh, id: "node_1", driver: "LOCAL", basePath: tempRoot } });
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("image/jpeg");
	}, 30_000);

	it("opens at most four connections to a node for the tiles of one folder", async () => {
		// Every tile opened its own SSH connection at once. sshd drops connections past ten unauthenticated ones
		// (MaxStartups 10:30:100); one drop opened the breaker and the rest of the folder showed "unavailable" for
		// two minutes. The sources were also all held in memory together (445 MB for forty 9 MB photos, 203 MB four
		// at a time).
		const picture = await sharp({ create: { width: 640, height: 480, channels: 3, background: "#804020" } }).png().toBuffer();
		let open = 0;
		let mostOpen = 0;
		connectSshMock.mockImplementation(async () => {
			open += 1;
			mostOpen = Math.max(mostOpen, open);
			await new Promise((resolve) => setTimeout(resolve, 15));
			const client = new EventEmitter() as EventEmitter & { sftp: unknown; end: () => void };
			client.sftp = (callback: (error: Error | undefined, sftp: unknown) => void) => callback(undefined, {
				stat: (_path: string, done: (error: Error | undefined, stats: { isFile: () => boolean; size: number }) => void) => done(undefined, { isFile: () => true, size: picture.length }),
				createReadStream: () => Readable.from([picture]),
			});
			client.end = () => { open -= 1; };
			return client;
		});
		const node = {
			id: "node_sftp", driver: "SFTP", basePath: "/data", host: null, port: null, username: null, hostKeySha256: "PIN",
			server: { id: "srv", host: "203.0.113.30", port: 22, username: "deploy", connectionType: "PASSWORD", managementMode: "DIRECT", operatingSystem: "LINUX", password: "secret", hostKeySha256: "PIN", sshKey: null },
		};
		const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => respondWithStorageThumbnail({ id: `tile_${index}`, relativePath: `pics/${index}.png`, node })));
		expect(responses.map((response) => response.headers.get("Content-Type"))).toEqual(Array.from({ length: 12 }, () => "image/jpeg"));
		expect(connectSshMock).toHaveBeenCalledTimes(12);
		expect(mostOpen).toBeLessThanOrEqual(4);
	}, 30_000);

	it("gives concurrent requests for one missing file each a readable placeholder", async () => {
		// They shared one response object, and only the first could read it.
		const input = { id: "file_4", relativePath: "pics/gone.png", node: { ...noSsh, id: "node_1", driver: "LOCAL", basePath: tempRoot } };
		const [a, b] = await Promise.all([respondWithStorageThumbnail(input), respondWithStorageThumbnail(input)]);
		expect(a).not.toBe(b);
		const [bodyA, bodyB] = await Promise.all([a.text(), b.text()]);
		expect(bodyA).toContain("<svg");
		expect(bodyB).toBe(bodyA);
		expect(b.headers.get("X-Thumbnail-Placeholder")).toBe("offline");
	});
});
