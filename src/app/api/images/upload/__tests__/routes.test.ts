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
import { rm } from "node:fs/promises";
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
		extractMetadata: vi.fn(),
		generateThumbnail: vi.fn(),
		convertToWebP: vi.fn(),
		convertToAVIF: vi.fn(),
	},
}));

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
		cancelMediaUploadSession: mocks.cancelMediaUploadSession,
		getMediaUploadSession: mocks.getMediaUploadSession,
	};
});

vi.mock("@/lib/audit/service", () => ({
	auditUserAction: mocks.auditUserAction,
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		mediaUploadSession: { findFirst: vi.fn() },
		imageUpload: { create: mocks.imageCreate },
	},
}));

vi.mock("@/lib/image/service", () => ({
	extractMetadata: mocks.extractMetadata,
	generateThumbnail: mocks.generateThumbnail,
	convertToWebP: mocks.convertToWebP,
	convertToAVIF: mocks.convertToAVIF,
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
		expect(mocks.initMediaUploadSession).toHaveBeenCalledWith({
			userId: "u-admin",
			filename: "photo.png",
			mimeType: "image/png",
			totalSize: 1024 * 1024,
			chunkSize: 65536,
		});
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u-admin",
			"media.upload.init",
			expect.objectContaining({
				sessionId: "sess_1",
				filename: "photo.png",
				totalChunks: 16,
			}),
			"INFO",
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
});

// ── POST /api/images/upload/[id]/complete ────────────────────────────────
describe("POST /api/images/upload/[id]/complete", () => {
	it("assembles chunks, runs the image pipeline, and marks COMPLETED", async () => {
		const { prisma } = await import("@/lib/db");
		vi.mocked(prisma.mediaUploadSession.findFirst).mockResolvedValue({
			filename: "photo.png",
			mimeType: "image/png",
		} as never);
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
		);
		const body = await res.json();
		expect(body.session.status).toBe("COMPLETED");
		expect(body.image.publicUrl).toBe("/api/images/img_1/file");
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
