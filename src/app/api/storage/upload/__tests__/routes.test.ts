import { beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_CHUNK_SIZE, MAX_TOTAL_SIZE, MIN_CHUNK_SIZE } from "@/lib/upload/types";

/**
 * Contract tests for the chunked storage-upload pair:
 *   POST /api/storage/upload/init      — opens the session
 *   POST /api/storage/upload/[id]/complete — assembles and indexes it
 *
 * The schemas are kept real here on purpose: `relativePath` is the one field a
 * caller controls that ends up as a filesystem path, so the traversal and
 * absolute-path rejections are part of this route's contract, not an
 * implementation detail of the service behind it. Everything below the route —
 * the storage ACL, the per-user session scoping, the quota guard — is covered by
 * `src/lib/storage/__tests__/resumable-upload.test.ts`; what is pinned here is
 * that the routes ask for the right permission, hand the service exactly what
 * the caller sent, and let a typed service error keep its own status.
 */
const mocks = vi.hoisted(() => ({
	initMediaUploadSession: vi.fn(),
	completeStorageFileUpload: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

vi.mock("@/lib/upload/service", () => ({
	initMediaUploadSession: mocks.initMediaUploadSession,
	// The route branches on `instanceof MediaUploadError`; a stand-in class keeps
	// the test hermetic while preserving the (code, message) shape it reads.
	MediaUploadError: class MediaUploadError extends Error {
		constructor(
			readonly code: string,
			message: string,
		) {
			super(message);
			this.name = "MediaUploadError";
		}
	},
}));

vi.mock("@/lib/storage/resumable-upload", () => ({
	completeStorageFileUpload: mocks.completeStorageFileUpload,
}));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) {
				return Response.json(
					{ error: "输入参数无效", issues: parsed.error.issues.map((i: any) => i.message) },
					{ status: 400 },
				);
			}
			body = parsed.data;
		}
		try {
			return await handler({ session, body });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
			const status = (error as { status?: number }).status ?? options.errorStatus ?? 500;
			return Response.json({ error: (error as Error).message }, { status });
		}
	}),
}));

const session = {
	userId: "u_1",
	username: "op",
	roles: ["operator"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const init = await import("../init/route");
const complete = await import("../[id]/complete/route");

const completeParams = { params: Promise.resolve({ id: "sess_1" }) };

function post(url: string, body?: unknown) {
	return new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const INIT_URL = "https://a.test/api/storage/upload/init";
const COMPLETE_URL = "https://a.test/api/storage/upload/sess_1/complete";

function initBody(overrides: Record<string, unknown> = {}) {
	return {
		filename: "report.pdf",
		mimeType: "application/pdf",
		totalSize: 1024,
		storageNodeId: "node_1",
		relativePath: "docs/report.pdf",
		...overrides,
	};
}

const sessionView = {
	id: "sess_1",
	filename: "report.pdf",
	mimeType: "application/pdf",
	totalSize: 1024,
	chunkSize: 5 * 1024 * 1024,
	totalChunks: 1,
	receivedChunks: [],
	status: "PENDING",
};

describe("storage chunked upload routes", () => {
	beforeEach(() => {
		mocks.initMediaUploadSession.mockReset();
		mocks.completeStorageFileUpload.mockReset();
		mocks.auditUserAction.mockReset();
		mocks.guardCalls.length = 0;
		mocks.initMediaUploadSession.mockResolvedValue(sessionView);
		mocks.completeStorageFileUpload.mockResolvedValue({
			session: { ...sessionView, status: "COMPLETED" },
			relativePath: "docs/report.pdf",
			size: 1024,
			storageNodeId: "node_1",
		});
	});

	describe("guard contract", () => {
		it("requires storage:write and a write rate limit on init", async () => {
			await init.POST(post(INIT_URL, initBody()));
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "storage:write",
				rateLimit: { maxRequests: 30, windowMs: 60_000 },
			});
		});

		it("requires storage:write and a write rate limit on complete", async () => {
			await complete.POST(post(COMPLETE_URL), completeParams);
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "storage:write",
				rateLimit: { maxRequests: 30, windowMs: 60_000 },
			});
		});

		it("does not accept a body schema on complete — the id comes from the URL", async () => {
			await complete.POST(post(COMPLETE_URL, { sessionId: "someone-elses" }), completeParams);
			expect(mocks.guardCalls[0]?.bodySchema).toBeUndefined();
			expect(mocks.completeStorageFileUpload).toHaveBeenCalledWith({
				sessionId: "sess_1",
				session,
			});
		});
	});

	describe("POST /api/storage/upload/init", () => {
		it("opens a session and returns 201 with the view", async () => {
			const res = await init.POST(post(INIT_URL, initBody()));
			const json = await res.json();

			expect(res.status).toBe(201);
			expect(json.session).toMatchObject({ id: "sess_1", status: "PENDING" });
			expect(mocks.initMediaUploadSession).toHaveBeenCalledWith({
				userId: "u_1",
				filename: "report.pdf",
				mimeType: "application/pdf",
				totalSize: 1024,
				session,
				storageNodeId: "node_1",
				relativePath: "docs/report.pdf",
			});
		});

		it("omits chunkSize entirely when the caller did not pick one", async () => {
			await init.POST(post(INIT_URL, initBody()));
			const args = mocks.initMediaUploadSession.mock.calls[0]?.[0] as Record<string, unknown>;
			expect("chunkSize" in args).toBe(false);
		});

		it("forwards an explicit chunkSize", async () => {
			await init.POST(post(INIT_URL, initBody({ chunkSize: MIN_CHUNK_SIZE })));
			expect(mocks.initMediaUploadSession).toHaveBeenCalledWith(
				expect.objectContaining({ chunkSize: MIN_CHUNK_SIZE }),
			);
		});

		it("audits the opened session under the caller's team", async () => {
			await init.POST(post(INIT_URL, initBody()));
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"storage.upload.init",
				{
					sessionId: "sess_1",
					filename: "report.pdf",
					mimeType: "application/pdf",
					totalSize: 1024,
					storageNodeId: "node_1",
					relativePath: "docs/report.pdf",
				},
				"INFO",
				"team_1",
			);
		});

		it.each([
			["a traversal segment", "docs/../../etc/passwd"],
			["an absolute path", "/etc/passwd"],
			["a bare traversal", ".."],
			["an empty path", ""],
		])("rejects %s in relativePath", async (_label, relativePath) => {
			const res = await init.POST(post(INIT_URL, initBody({ relativePath })));
			expect(res.status).toBe(400);
			expect(mocks.initMediaUploadSession).not.toHaveBeenCalled();
		});

		it.each([
			["a filename with a path separator", { filename: "a/b.pdf" }],
			["an SVG filename", { filename: "logo.svg" }],
			["a malformed mimeType", { mimeType: "not-a-mime" }],
			["totalSize 0", { totalSize: 0 }],
			["a fractional totalSize", { totalSize: 10.5 }],
			["totalSize over the cap", { totalSize: MAX_TOTAL_SIZE + 1 }],
			["chunkSize under the floor", { chunkSize: MIN_CHUNK_SIZE - 1 }],
			["chunkSize over the cap", { chunkSize: MAX_CHUNK_SIZE + 1 }],
			["a missing storageNodeId", { storageNodeId: "" }],
		])("rejects %s", async (_label, overrides) => {
			const res = await init.POST(post(INIT_URL, initBody(overrides)));
			expect(res.status).toBe(400);
			expect(mocks.initMediaUploadSession).not.toHaveBeenCalled();
		});

		it("turns a MediaUploadError into a 400 that keeps the service code", async () => {
			const { MediaUploadError } = await import("@/lib/upload/service");
			mocks.initMediaUploadSession.mockRejectedValue(
				new MediaUploadError("storage_access_denied", "Quota exceeded for this node"),
			);

			const res = await init.POST(post(INIT_URL, initBody()));
			const json = await res.json();

			expect(res.status).toBe(400);
			expect(json.error).toBe("Quota exceeded for this node");
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("lets an unexpected failure fall through to the guard's 500", async () => {
			mocks.initMediaUploadSession.mockRejectedValue(new Error("ENOSPC"));
			const res = await init.POST(post(INIT_URL, initBody()));
			expect(res.status).toBe(500);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});
	});

	describe("POST /api/storage/upload/[id]/complete", () => {
		it("finalizes the session and returns the indexed result", async () => {
			const res = await complete.POST(post(COMPLETE_URL), completeParams);
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json).toMatchObject({
				relativePath: "docs/report.pdf",
				size: 1024,
				storageNodeId: "node_1",
				session: { status: "COMPLETED" },
			});
		});

		it("audits the completion under the caller's team", async () => {
			await complete.POST(post(COMPLETE_URL), completeParams);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"storage.upload.complete",
				{
					sessionId: "sess_1",
					storageNodeId: "node_1",
					relativePath: "docs/report.pdf",
					size: 1024,
				},
				"INFO",
				"team_1",
			);
		});

		it("keeps a 400 when the session is not the caller's", async () => {
			const { ValidationError } = await import("@/lib/errors");
			mocks.completeStorageFileUpload.mockRejectedValue(
				new ValidationError("Upload session not found or does not belong to the current user", {
					code: "session_not_found",
				}),
			);

			const res = await complete.POST(post(COMPLETE_URL), completeParams);

			expect(res.status).toBe(400);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("keeps a 403 when the storage ACL refuses the write", async () => {
			const { ForbiddenError } = await import("@/lib/errors");
			mocks.completeStorageFileUpload.mockRejectedValue(
				new ForbiddenError("No permission to write to the storage path"),
			);

			const res = await complete.POST(post(COMPLETE_URL), completeParams);

			expect(res.status).toBe(403);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("falls back to 500 for an unexpected finalization failure", async () => {
			mocks.completeStorageFileUpload.mockRejectedValue(new Error("sftp write failed"));
			const res = await complete.POST(post(COMPLETE_URL), completeParams);
			expect(res.status).toBe(500);
		});
	});
});
