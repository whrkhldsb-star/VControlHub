/**
 * TR-009 55c: API route tests for chunked media upload.
 *
 * Covers:
 *   - POST /api/images/upload/init              (storage:write, init schema)
 *   - PUT  /api/images/upload/[id]/chunk        (storage:write, raw body, query schema)
 *   - POST /api/images/upload/[id]/complete     (storage:write, assembly + image pipeline)
 *   - GET  /api/images/upload/[id]              (storage:write, owner-scoped view)
 *   - DELETE /api/images/upload/[id]            (storage:write, cancel + cleanup)
 *
 * Mocks: requireApiPermission (auth gate) + service.upload functions +
 * audit + db prisma + image service + UPLOAD_DIR constant + filesystem
 * `node:fs/promises` for the complete route.
 */
import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		initMediaUploadSession: vi.fn(),
		appendMediaUploadChunk: vi.fn(),
		assembleMediaUploadChunks: vi.fn(),
		completeMediaUploadSession: vi.fn(),
		cancelMediaUploadSession: vi.fn(),
		getMediaUploadSession: vi.fn(),
		auditUserAction: vi.fn(),
		imageCreate: vi.fn(),
		imageDelete: vi.fn(),
		sessionUpdateMany: vi.fn(),
		storageFindFirst: vi.fn(),
		assertStorageAccess: vi.fn(),
		releaseStorageQuotaGuard: vi.fn(),
		indexLinkedStorageImage: vi.fn(),
		randomUUID: vi.fn(),
		extractMetadata: vi.fn(),
		generateThumbnail: vi.fn(),
		convertToWebP: vi.fn(),
		convertToAVIF: vi.fn(),
	},
}));

vi.mock("node:crypto", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:crypto")>();
	return { ...actual, randomUUID: () => mocks.randomUUID() ?? actual.randomUUID() };
});

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));

vi.mock("@/lib/upload/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/upload/service")>();
	return {
		...actual,
		initMediaUploadSession: mocks.initMediaUploadSession,
		appendMediaUploadChunk: mocks.appendMediaUploadChunk,
		assembleMediaUploadChunks: mocks.assembleMediaUploadChunks,
		completeMediaUploadSession: mocks.completeMediaUploadSession,
		cleanupMediaUploadTempDir: vi.fn(async () => undefined),
		cancelMediaUploadSession: mocks.cancelMediaUploadSession,
		getMediaUploadSession: mocks.getMediaUploadSession,
	};
});

vi.mock("@/lib/audit/service", () => ({
	auditUserAction: mocks.auditUserAction,
}));

vi.mock("@/lib/db", () => {
	const prisma = {
		mediaUploadSession: { findFirst: vi.fn(), updateMany: mocks.sessionUpdateMany },
		imageUpload: { create: mocks.imageCreate, delete: mocks.imageDelete },
		storageNode: { findFirst: mocks.storageFindFirst },
	};
	return { prisma: { ...prisma, $transaction: vi.fn(async (callback) => callback(prisma)) } };
});

vi.mock("@/lib/storage/access-control", () => ({
	assertStorageAccess: mocks.assertStorageAccess,
	releaseStorageQuotaGuard: mocks.releaseStorageQuotaGuard,
}));
vi.mock("@/lib/image-bed/linked-storage", () => ({
	indexLinkedStorageImage: mocks.indexLinkedStorageImage,
}));

vi.mock("@/lib/image/service", () => ({
	extractMetadata: mocks.extractMetadata,
	generateThumbnail: mocks.generateThumbnail,
	convertToWebP: mocks.convertToWebP,
	convertToAVIF: mocks.convertToAVIF,
	canonicalImageMime: (format?: string) =>
		format ? (format === "svg" ? "image/svg+xml" : `image/${format}`) : "application/octet-stream",
	MAX_IMAGE_PIXELS: 50_000_000,
}));

vi.mock("@/lib/http/rate-limit-presets", async (importOriginal) => {
	const actual = await importOriginal<
		typeof import("@/lib/http/rate-limit-presets")
	>();
	return {
		...actual,
		withRateLimit: vi.fn().mockResolvedValue({
			allowed: true,
			retryAfterMs: 0,
			remaining: 999,
		}),
		rateLimitResponse: actual.rateLimitResponse,
	};
});

const TMP_UPLOAD = path.join(os.tmpdir(), "vcontrolhub-upload-route-test");
vi.mock("@/lib/image-bed/constants", () => ({
	UPLOAD_DIR: TMP_UPLOAD,
}));

const initRoute = await import("../init/route");
const chunkRoute = await import("../[id]/chunk/route");
const completeRoute = await import("../[id]/complete/route");
const sessionRoute = await import("../[id]/route");

const adminSession = {
	userId: "u-admin",
	username: "admin",
	roles: ["admin"] as const,
	currentTeamId: "team-a",
};

const SAMPLE_INIT_VIEW = {
	id: "sess_1",
	filename: "photo.png",
	mimeType: "image/png",
	totalSize: 1024 * 1024,
	chunkSize: 65536,
	totalChunks: 16,
	receivedChunks: [],
	missingChunks: Array.from({ length: 16 }, (_, i) => i),
	storageNodeId: null,
	relativePath: null,
	status: "PENDING" as const,
	resultImageId: null,
	checksum: null,
	errorMessage: null,
	completedAt: null,
	expiresAt: "2026-06-18T00:00:00.000Z",
	createdAt: "2026-06-17T00:00:00.000Z",
	updatedAt: "2026-06-17T00:00:00.000Z",
};

const SAMPLE_UPLOADING_VIEW = {
	...SAMPLE_INIT_VIEW,
	status: "UPLOADING" as const,
	receivedChunks: [0],
	missingChunks: SAMPLE_INIT_VIEW.missingChunks.filter((i) => i !== 0),
};

const SAMPLE_COMPLETED_VIEW = {
	...SAMPLE_INIT_VIEW,
	status: "COMPLETED" as const,
	receivedChunks: [0, 1, 2, 3],
	missingChunks: [],
	resultImageId: "img_1",
	checksum: "deadbeef".repeat(8),
	completedAt: "2026-06-17T00:01:00.000Z",
};

beforeEach(async () => {
	vi.clearAllMocks();
	mocks.requireApiPermission.mockResolvedValue({ session: adminSession });
	mocks.initMediaUploadSession.mockResolvedValue(SAMPLE_INIT_VIEW);
	mocks.appendMediaUploadChunk.mockResolvedValue(SAMPLE_UPLOADING_VIEW);
	mocks.assembleMediaUploadChunks.mockResolvedValue(
		Buffer.from("assembled-bytes"),
	);
	mocks.completeMediaUploadSession.mockResolvedValue(SAMPLE_COMPLETED_VIEW);
	mocks.cancelMediaUploadSession.mockResolvedValue({
		...SAMPLE_INIT_VIEW,
		status: "CANCELLED" as const,
	});
	mocks.getMediaUploadSession.mockResolvedValue(SAMPLE_INIT_VIEW);
	mocks.imageCreate.mockResolvedValue({ id: "img_1" });
	mocks.imageDelete.mockResolvedValue({ id: "img_1" });
	mocks.sessionUpdateMany.mockResolvedValue({ count: 1 });
	mocks.assertStorageAccess.mockResolvedValue({ allowed: true });
	mocks.releaseStorageQuotaGuard.mockResolvedValue(undefined);
	mocks.indexLinkedStorageImage.mockResolvedValue(undefined);
	mocks.extractMetadata.mockResolvedValue({ width: 10, height: 10, format: "png" });
	mocks.generateThumbnail.mockResolvedValue(Buffer.from("thumb"));
	mocks.convertToWebP.mockResolvedValue(Buffer.from("webp"));
	mocks.convertToAVIF.mockResolvedValue(Buffer.from("avif"));
	await rm(TMP_UPLOAD, { recursive: true, force: true });
});

afterEach(async () => {
	await rm(TMP_UPLOAD, { recursive: true, force: true });
});

// ── POST /api/images/upload/init ─────────────────────────────────────────
describe("POST /api/images/upload/init", () => {
	it("initialises a session and writes an audit entry", async () => {
		const res = await initRoute.POST(
			new Request("http://local/api/images/upload/init", {
				method: "POST",
				body: JSON.stringify({
					filename: "photo.png",
					mimeType: "image/png",
					totalSize: 1024 * 1024,
					chunkSize: 65536,
				}),
			}),
		);
		const text = await res.clone().text();
		expect(res.status, "body=" + text).toBe(201);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("storage:write");
		expect(mocks.initMediaUploadSession).toHaveBeenCalledWith(
			expect.objectContaining({
				userId: "u-admin",
				filename: "photo.png",
				mimeType: "image/png",
				totalSize: 1024 * 1024,
				chunkSize: 65536,
			}),
		);
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u-admin",
			"media.upload.init",
			expect.objectContaining({
				sessionId: "sess_1",
				filename: "photo.png",
				totalChunks: 16,
			}),
			"INFO",
			// The uploader's workspace must reach the audit row; an unstamped row is
			// teamId: null, which teamWhere shows to every tenant.
			"team-a",
		);
		const body = await res.json();
		expect(body.session).toEqual(SAMPLE_INIT_VIEW);
	});

	it("rejects invalid filename (path separator) with 400", async () => {
		const res = await initRoute.POST(
			new Request("http://local/api/images/upload/init", {
				method: "POST",
				body: JSON.stringify({
					filename: "../etc/passwd",
					mimeType: "image/png",
					totalSize: 1024,
				}),
			}),
		);
		expect(res.status).toBe(400);
		expect(mocks.initMediaUploadSession).not.toHaveBeenCalled();
	});

	it("rejects unsupported mime type with 400", async () => {
		const res = await initRoute.POST(
			new Request("http://local/api/images/upload/init", {
				method: "POST",
				body: JSON.stringify({
					filename: "doc.pdf",
					mimeType: "application/pdf",
					totalSize: 1024,
				}),
			}),
		);
		expect(res.status).toBe(400);
		expect(mocks.initMediaUploadSession).not.toHaveBeenCalled();
	});

	it("returns 403 when the caller lacks storage:write", async () => {
		mocks.requireApiPermission.mockResolvedValueOnce(
			NextResponse.json({ error: "缺少权限" }, { status: 403 }),
		);
		const res = await initRoute.POST(
			new Request("http://local/api/images/upload/init", {
				method: "POST",
				body: JSON.stringify({
					filename: "x.png",
					mimeType: "image/png",
					totalSize: 1,
				}),
			}),
		);
		expect(res.status).toBe(403);
	});
});

// ── PUT /api/images/upload/[id]/chunk ────────────────────────────────────
describe("PUT /api/images/upload/[id]/chunk", () => {
	it("appends a chunk from raw bytes and returns the updated session", async () => {
		const res = await chunkRoute.PUT(
			new Request(
				"http://local/api/images/upload/sess_1/chunk?index=0&size=4",
				{
					method: "PUT",
					headers: { "Content-Type": "application/octet-stream" },
					body: Buffer.from("AAAA"),
				},
			),
			{ params: Promise.resolve({ id: "sess_1" }) },
		);
		const text = await res.clone().text();
		expect(res.status, "body=" + text).toBe(200);
		expect(mocks.appendMediaUploadChunk).toHaveBeenCalledWith({
			sessionId: "sess_1",
			userId: "u-admin",
			index: 0,
			size: 4,
			buffer: expect.any(Buffer),
		});
		expect(mocks.appendMediaUploadChunk.mock.calls[0]![0].buffer).toEqual(
			Buffer.from("AAAA"),
		);
		const body = await res.json();
		expect(body.session).toEqual(SAMPLE_UPLOADING_VIEW);
	});

	it("rejects missing query params with 400", async () => {
		const res = await chunkRoute.PUT(
			new Request("http://local/api/images/upload/sess_1/chunk", {
				method: "PUT",
				body: Buffer.from("AAAA"),
			}),
			{ params: Promise.resolve({ id: "sess_1" }) },
		);
		expect(res.status).toBe(400);
		expect(mocks.appendMediaUploadChunk).not.toHaveBeenCalled();
	});

	it("rejects negative index with 400", async () => {
		const res = await chunkRoute.PUT(
			new Request(
				"http://local/api/images/upload/sess_1/chunk?index=-1&size=4",
				{
					method: "PUT",
					body: Buffer.from("AAAA"),
				},
			),
			{ params: Promise.resolve({ id: "sess_1" }) },
		);
		expect(res.status).toBe(400);
		expect(mocks.appendMediaUploadChunk).not.toHaveBeenCalled();
	});

	it("maps service error session_not_found to 400", async () => {
		const { MediaUploadError } = await import("@/lib/upload/service");
		mocks.appendMediaUploadChunk.mockRejectedValueOnce(
			new MediaUploadError("session_not_found", "上传会话不存在"),
		);
		const res = await chunkRoute.PUT(
			new Request(
				"http://local/api/images/upload/missing/chunk?index=0&size=1",
				{
					method: "PUT",
					body: Buffer.from("X"),
				},
			),
			{ params: Promise.resolve({ id: "missing" }) },
		);
		expect(res.status).toBe(400);
	});

	it("rejects a body larger than its declared chunk size", async () => {
		const res = await chunkRoute.PUT(
			new Request(
				"http://local/api/images/upload/sess_1/chunk?index=0&size=3",
				{ method: "PUT", body: Buffer.from("AAAA") },
			),
			{ params: Promise.resolve({ id: "sess_1" }) },
		);

		expect(res.status).toBe(413);
		expect(mocks.appendMediaUploadChunk).not.toHaveBeenCalled();
	});
});

// ── POST /api/images/upload/[id]/complete ────────────────────────────────
describe("POST /api/images/upload/[id]/complete", () => {
	const complete = () => completeRoute.POST(
		new Request("http://local/api/images/upload/sess_1/complete", { method: "POST" }),
		{ params: Promise.resolve({ id: "sess_1" }) },
	);
	async function setStoredFile(filename: string, linked = false) {
		const { prisma } = await import("@/lib/db");
		vi.mocked(prisma.mediaUploadSession.findFirst).mockResolvedValueOnce({
			filename, mimeType: "image/png", totalSize: BigInt(15),
			storageNodeId: linked ? "node_1" : null,
			relativePath: linked ? "gallery" : null,
		} as never);
	}
	beforeEach(async () => {
		const { prisma } = await import("@/lib/db");
		vi.mocked(prisma.mediaUploadSession.findFirst).mockResolvedValue({
			filename: "photo.png",
			mimeType: "image/png",
			totalSize: BigInt(Buffer.byteLength("assembled-bytes")),
			storageNodeId: null,
			relativePath: null,
		} as never);
	});

	it("assembles chunks, runs the image pipeline, and marks COMPLETED", async () => {
		const res = await completeRoute.POST(
			new Request(
				"http://local/api/images/upload/sess_1/complete",
				{ method: "POST" },
			),
			{ params: Promise.resolve({ id: "sess_1" }) },
		);
		expect(res.status).toBe(200);
		expect(mocks.assembleMediaUploadChunks).toHaveBeenCalledWith(
			"sess_1",
			"u-admin",
		);
		expect(mocks.imageCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({
					filename: "photo.png",
					mimeType: "image/png",
					userId: "u-admin",
					isPublic: false,
				}),
			}),
		);
		expect(mocks.completeMediaUploadSession).toHaveBeenCalledWith(
			expect.objectContaining({
				sessionId: "sess_1",
				userId: "u-admin",
				buffer: expect.any(Buffer),
				resultImageId: "img_1",
			}),
		);
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u-admin",
			"media.upload.complete",
			expect.objectContaining({ sessionId: "sess_1", imageId: "img_1" }),
			"INFO",
			"team-a",
		);
		const body = await res.json();
		expect(body.session.status).toBe("COMPLETED");
		expect(body.image.publicUrl).toBe("/api/images/img_1/file");
	});

	it.each(["photo.webp", "photo.avif"])("keeps assembled PNG bytes when the filename is %s", async (filename) => {
		await setStoredFile(filename);
		expect((await complete()).status).toBe(200);
		const { storageKey } = mocks.imageCreate.mock.calls[0]![0].data;
		expect(await readFile(path.join(TMP_UPLOAD, storageKey))).toEqual(Buffer.from("assembled-bytes"));
	});

	it("rejects a competing finalizer before creating files or image rows", async () => {
		mocks.sessionUpdateMany.mockResolvedValueOnce({ count: 0 });
		expect((await complete()).status).toBe(400);
		expect(mocks.imageCreate).not.toHaveBeenCalled();
		expect(mocks.generateThumbnail).not.toHaveBeenCalled();
		expect(mocks.sessionUpdateMany).toHaveBeenCalledTimes(1);
	});

	it("rolls back image artifacts when committing upload completion fails", async () => {
		mocks.completeMediaUploadSession.mockRejectedValueOnce(new Error("completion failed"));
		expect((await complete()).status).toBe(500);
		expect(await readdir(TMP_UPLOAD)).toEqual([]);
		expect(mocks.auditUserAction).not.toHaveBeenCalled();
		expect(mocks.sessionUpdateMany).toHaveBeenLastCalledWith(expect.objectContaining({
			where: { id: "sess_1", userId: "u-admin", status: "FINALIZING" },
			data: expect.objectContaining({ status: "FAILED" }),
		}));
	});

	it("waits for delayed variants before cleaning up a failed original write", async () => {
		// An existing directory makes the original write fail on the real filesystem.
		mocks.randomUUID.mockReturnValue("blocked-original");
		await mkdir(path.join(TMP_UPLOAD, "blocked-original.png"), { recursive: true });
		let thumbnailFinished = false;
		const thumbnail = new Promise<Buffer>((resolve) => {
			setTimeout(() => { thumbnailFinished = true; resolve(Buffer.from("thumb")); }, 50);
		});
		mocks.generateThumbnail.mockReturnValueOnce(thumbnail);
		try {
			expect((await complete()).status).toBe(500);
			expect(thumbnailFinished).toBe(true);
			expect(await readdir(TMP_UPLOAD)).toEqual(["blocked-original.png"]);
			expect(mocks.imageCreate).not.toHaveBeenCalled();
		} finally {
			await thumbnail;
			mocks.randomUUID.mockReset();
		}
	});

	it.each(["denied", "throws"])("cleans original and variants when storage authorization %s", async (failure) => {
		await setStoredFile("photo.png", true);
		if (failure === "denied") mocks.assertStorageAccess.mockResolvedValueOnce({ allowed: false });
		else mocks.assertStorageAccess.mockRejectedValueOnce(new Error("storage lookup failed"));
		expect((await complete()).status).toBe(failure === "denied" ? 403 : 500);
		expect(await readdir(TMP_UPLOAD)).toEqual([]);
		expect(mocks.imageCreate).not.toHaveBeenCalled();
		expect(mocks.completeMediaUploadSession).not.toHaveBeenCalled();
	});

	it("keeps the quota lock until linked file indexing commits", async () => {
		await setStoredFile("photo.png", true);
		const localRoot = path.join(os.tmpdir(), "vcontrolhub-chunk-upload-quota-test");
		const access = { allowed: true, releaseQuotaGuard: vi.fn() };
		mocks.assertStorageAccess.mockResolvedValueOnce(access);
		mocks.storageFindFirst.mockResolvedValueOnce({ id: "node_1", driver: "LOCAL", basePath: localRoot });
		let finishIndexing!: () => void;
		mocks.indexLinkedStorageImage.mockReturnValueOnce(new Promise<void>((resolve) => { finishIndexing = resolve; }));
		const pending = complete();
		try {
			await vi.waitFor(() => expect(mocks.indexLinkedStorageImage).toHaveBeenCalled());
			expect(mocks.releaseStorageQuotaGuard).not.toHaveBeenCalled();
			finishIndexing();
			expect((await pending).status).toBe(200);
			expect(mocks.releaseStorageQuotaGuard).toHaveBeenCalledExactlyOnceWith(access);
		} finally {
			finishIndexing();
			await pending;
			await rm(localRoot, { recursive: true, force: true });
		}
	});

	it("returns 400 when assembly reports missing chunks", async () => {
		const { MediaUploadError } = await import("@/lib/upload/service");
		mocks.assembleMediaUploadChunks.mockRejectedValueOnce(
			new MediaUploadError("chunks_incomplete", "缺失 2 个 chunk: 0, 1"),
		);
		const res = await completeRoute.POST(
			new Request(
				"http://local/api/images/upload/sess_1/complete",
				{ method: "POST" },
			),
			{ params: Promise.resolve({ id: "sess_1" }) },
		);
		expect(res.status).toBe(400);
		expect(mocks.imageCreate).not.toHaveBeenCalled();
		expect(mocks.completeMediaUploadSession).not.toHaveBeenCalled();
	});

	it("returns 400 when the session is missing", async () => {
		const { prisma } = await import("@/lib/db");
		vi.mocked(prisma.mediaUploadSession.findFirst).mockResolvedValueOnce(
			null as never,
		);
		const res = await completeRoute.POST(
			new Request(
				"http://local/api/images/upload/missing/complete",
				{ method: "POST" },
			),
			{ params: Promise.resolve({ id: "missing" }) },
		);
		expect(res.status).toBe(400);
	});

	it("rejects an oversized legacy image session before assembly", async () => {
		const { prisma } = await import("@/lib/db");
		vi.mocked(prisma.mediaUploadSession.findFirst).mockResolvedValueOnce({
			filename: "large.png",
			mimeType: "image/png",
			totalSize: BigInt(20 * 1024 * 1024 + 1),
			storageNodeId: null,
			relativePath: null,
		} as never);

		const res = await completeRoute.POST(
			new Request("http://local/api/images/upload/legacy/complete", {
				method: "POST",
			}),
			{ params: Promise.resolve({ id: "legacy" }) },
		);

		expect(res.status).toBe(400);
		expect(mocks.assembleMediaUploadChunks).not.toHaveBeenCalled();
	});

	it("rejects a decompression bomb whose decoded dimensions exceed the pixel cap", async () => {
		mocks.extractMetadata.mockResolvedValueOnce({
			width: 60000,
			height: 60000,
			format: "png",
		});

		const res = await completeRoute.POST(
			new Request("http://local/api/images/upload/sess_1/complete", {
				method: "POST",
			}),
			{ params: Promise.resolve({ id: "sess_1" }) },
		);

		expect(res.status).toBe(400);
		expect(mocks.imageCreate).not.toHaveBeenCalled();
		expect(mocks.completeMediaUploadSession).not.toHaveBeenCalled();
	});

	it("persists the sharp-detected MIME, not the session-declared type", async () => {
		// Session row claims image/png; sharp sniffs webp. Stored record must
		// follow the real bytes.
		mocks.extractMetadata.mockResolvedValueOnce({
			width: 10,
			height: 10,
			format: "webp",
		});

		const res = await completeRoute.POST(
			new Request("http://local/api/images/upload/sess_1/complete", {
				method: "POST",
			}),
			{ params: Promise.resolve({ id: "sess_1" }) },
		);

		expect(res.status).toBe(200);
		expect(mocks.imageCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ mimeType: "image/webp" }),
			}),
		);
	});
});

// ── GET /api/images/upload/[id] ──────────────────────────────────────────
describe("GET /api/images/upload/[id]", () => {
	it("returns the session view for the owner", async () => {
		const res = await sessionRoute.GET(
			new Request("http://local/api/images/upload/sess_1"),
			{ params: Promise.resolve({ id: "sess_1" }) },
		);
		expect(res.status).toBe(200);
		expect(mocks.getMediaUploadSession).toHaveBeenCalledWith(
			"sess_1",
			"u-admin",
		);
		const body = await res.json();
		expect(body.session).toEqual(SAMPLE_INIT_VIEW);
	});

	it("returns 404 when the session is not owned by the caller", async () => {
		mocks.getMediaUploadSession.mockResolvedValueOnce(null);
		const res = await sessionRoute.GET(
			new Request("http://local/api/images/upload/missing"),
			{ params: Promise.resolve({ id: "missing" }) },
		);
		expect(res.status).toBe(404);
	});
});

// ── DELETE /api/images/upload/[id] ───────────────────────────────────────
describe("DELETE /api/images/upload/[id]", () => {
	it("cancels the session and writes an audit entry", async () => {
		const res = await sessionRoute.DELETE(
			new Request("http://local/api/images/upload/sess_1", {
				method: "DELETE",
			}),
			{ params: Promise.resolve({ id: "sess_1" }) },
		);
		expect(res.status).toBe(200);
		expect(mocks.cancelMediaUploadSession).toHaveBeenCalledWith(
			"sess_1",
			"u-admin",
		);
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u-admin",
			"media.upload.cancel",
			{ sessionId: "sess_1", status: "CANCELLED" },
			"INFO",
			"team-a",
		);
		const body = await res.json();
		expect(body.session.status).toBe("CANCELLED");
	});

	it("returns 404 when the session is not owned by the caller", async () => {
		const { MediaUploadError } = await import("@/lib/upload/service");
		mocks.cancelMediaUploadSession.mockRejectedValueOnce(
			new MediaUploadError("session_not_found", "上传会话不存在或不属于当前用户"),
		);
		const res = await sessionRoute.DELETE(
			new Request("http://local/api/images/upload/missing", {
				method: "DELETE",
			}),
			{ params: Promise.resolve({ id: "missing" }) },
		);
		expect(res.status).toBe(404);
		expect(mocks.auditUserAction).not.toHaveBeenCalled();
	});
});
