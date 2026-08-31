import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the three file-version routes.
 *
 * Every one of them receives both ids from the URL, so the invariant is that the
 * route hands `fileEntryId`, `versionId` and the session to the service unchanged
 * and never reads a version by id alone — `@/lib/storage/file-versions` resolves
 * the entry through the storage ACL first and scopes the version by
 * `fileEntryId`, and those checks are only reachable if the route passes the pair
 * through. The service's own behaviour is covered by
 * `src/lib/storage/__tests__/file-versions.test.ts`; here we pin the guard
 * options, the audit trail, the download headers, and that a typed service error
 * keeps its status instead of becoming a blanket 400/500.
 */
const mocks = vi.hoisted(() => ({
	listFileVersions: vi.fn(),
	createManualFileVersion: vi.fn(),
	getFileVersionForDownload: vi.fn(),
	restoreFileVersion: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/storage/file-versions", () => ({
	listFileVersions: mocks.listFileVersions,
	createManualFileVersion: mocks.createManualFileVersion,
	getFileVersionForDownload: mocks.getFileVersionForDownload,
	restoreFileVersion: mocks.restoreFileVersion,
}));

vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) return Response.json({ error: "输入参数无效" }, { status: 400 });
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

const versions = await import("../route");
const download = await import("../[versionId]/download/route");
const restore = await import("../[versionId]/restore/route");

const entryParams = { params: Promise.resolve({ id: "file_1" }) };
const versionParams = { params: Promise.resolve({ id: "file_1", versionId: "ver_9" }) };

function req(method: string, url: string, body?: unknown) {
	return new Request(url, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const LIST_URL = "https://a.test/api/files/file_1/versions";
const DOWNLOAD_URL = "https://a.test/api/files/file_1/versions/ver_9/download";
const RESTORE_URL = "https://a.test/api/files/file_1/versions/ver_9/restore";

const versionView = {
	id: "ver_9",
	fileEntryId: "file_1",
	storageNodeId: "node_1",
	versionNumber: 3,
	name: "notes.txt",
	relativePath: "docs/notes.txt",
	mimeType: "text/plain",
	sizeBytes: 7,
	reason: "MANUAL",
	note: null,
	createdAt: new Date("2026-08-30T10:00:00.000Z").toISOString(),
};

async function blobResult(
	overrides: Partial<Omit<typeof versionView, "mimeType">> & { mimeType?: string | null } = {},
) {
	const { Readable } = await import("node:stream");
	return {
		version: { ...versionView, ...overrides },
		absolutePath: "/var/lib/vch/versions/ver_9.blob",
		stream: Readable.from(Buffer.from("content")),
	};
}

describe("file version routes", () => {
	beforeEach(() => {
		for (const stub of [
			mocks.listFileVersions,
			mocks.createManualFileVersion,
			mocks.getFileVersionForDownload,
			mocks.restoreFileVersion,
			mocks.auditUserAction,
		]) {
			stub.mockReset();
		}
		mocks.guardCalls.length = 0;
		mocks.listFileVersions.mockResolvedValue([versionView]);
		mocks.createManualFileVersion.mockResolvedValue(versionView);
		mocks.restoreFileVersion.mockResolvedValue({
			restored: versionView,
			newRestorePoint: { ...versionView, id: "ver_10", versionNumber: 4, reason: "RESTORE_POINT" },
		});
	});

	describe("guard contract", () => {
		it("lists under storage:read with no write rate limit", async () => {
			await versions.GET(req("GET", LIST_URL), entryParams);
			expect(mocks.guardCalls[0]).toMatchObject({ permission: "storage:read" });
			expect(mocks.guardCalls[0]?.rateLimit).toBeUndefined();
		});

		it("snapshots under storage:write behind a write rate limit", async () => {
			await versions.POST(req("POST", LIST_URL, {}), entryParams);
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "storage:write",
				rateLimit: { maxRequests: 30, windowMs: 60_000 },
				errorStatus: 400,
			});
		});

		it("downloads under storage:read", async () => {
			mocks.getFileVersionForDownload.mockResolvedValue(await blobResult());
			await download.GET(req("GET", DOWNLOAD_URL), versionParams);
			expect(mocks.guardCalls[0]).toMatchObject({ permission: "storage:read" });
		});

		it("restores under storage:write behind a write rate limit", async () => {
			await restore.POST(req("POST", RESTORE_URL), versionParams);
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "storage:write",
				rateLimit: { maxRequests: 30, windowMs: 60_000 },
				errorStatus: 400,
			});
		});
	});

	describe("GET /api/files/[id]/versions/[versionId]/download", () => {
		it("streams the blob with a version-prefixed filename", async () => {
			mocks.getFileVersionForDownload.mockResolvedValue(await blobResult());

			const res = await download.GET(req("GET", DOWNLOAD_URL), versionParams);

			expect(res.status).toBe(200);
			expect(await res.text()).toBe("content");
			expect(res.headers.get("Content-Type")).toBe("text/plain");
			expect(res.headers.get("Content-Length")).toBe("7");
			expect(res.headers.get("Content-Disposition")).toContain('filename="v3-notes.txt"');
			// A version blob must never be sniffed or cached by a shared proxy.
			expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(res.headers.get("Cache-Control")).toBe("private, no-store");
			expect(mocks.getFileVersionForDownload).toHaveBeenCalledWith({
				fileEntryId: "file_1",
				versionId: "ver_9",
				session,
			});
		});

		it("guesses the content type when the version stored none", async () => {
			mocks.getFileVersionForDownload.mockResolvedValue(
				await blobResult({ mimeType: null, name: "report.pdf" }),
			);
			const res = await download.GET(req("GET", DOWNLOAD_URL), versionParams);
			expect(res.headers.get("Content-Type")).toBe("application/pdf");
		});

		it("falls back to octet-stream for an unguessable name", async () => {
			mocks.getFileVersionForDownload.mockResolvedValue(
				await blobResult({ mimeType: null, name: "dump" }),
			);
			const res = await download.GET(req("GET", DOWNLOAD_URL), versionParams);
			expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
		});

		it("keeps a non-ASCII filename in the RFC 5987 parameter and folds the ASCII one", async () => {
			mocks.getFileVersionForDownload.mockResolvedValue(await blobResult({ name: "报告.txt" }));
			const res = await download.GET(req("GET", DOWNLOAD_URL), versionParams);
			const disposition = res.headers.get("Content-Disposition") ?? "";
			// A raw multi-byte name in the quoted form would produce an unparseable header.
			expect(disposition).toContain('filename="v3-__.txt"');
			expect(disposition).toContain(`filename*=UTF-8''${encodeURIComponent("v3-报告.txt")}`);
		});

		it("passes a missing-version 404 through unchanged", async () => {
			const { NotFoundError } = await import("@/lib/errors");
			mocks.getFileVersionForDownload.mockRejectedValue(new NotFoundError("version not found"));
			const res = await download.GET(req("GET", DOWNLOAD_URL), versionParams);
			expect(res.status).toBe(404);
		});
	});

	describe("POST /api/files/[id]/versions/[versionId]/restore", () => {
		it("restores the version and audits it at WARNING", async () => {
			const res = await restore.POST(req("POST", RESTORE_URL), versionParams);
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json.success).toBe(true);
			expect(json.restored).toMatchObject({ id: "ver_9", versionNumber: 3 });
			expect(json.restorePoint).toMatchObject({ id: "ver_10", reason: "RESTORE_POINT" });
			expect(mocks.restoreFileVersion).toHaveBeenCalledWith({
				fileEntryId: "file_1",
				versionId: "ver_9",
				session,
			});
			// Overwriting live storage is a destructive act: WARNING, not INFO.
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"file.version.restore",
				{
					fileEntryId: "file_1",
					versionId: "ver_9",
					restoredVersionNumber: 3,
					restorePointId: "ver_10",
				},
				"WARNING",
				"team_1",
			);
		});

		it("records a null restore point when the snapshot could not be taken", async () => {
			mocks.restoreFileVersion.mockResolvedValue({ restored: versionView, newRestorePoint: null });
			const res = await restore.POST(req("POST", RESTORE_URL), versionParams);

			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({ restorePoint: null });
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"file.version.restore",
				expect.objectContaining({ restorePointId: null }),
				"WARNING",
				"team_1",
			);
		});

		it("keeps a checksum-mismatch refusal as 422 and does not audit", async () => {
			const { BusinessError } = await import("@/lib/errors");
			mocks.restoreFileVersion.mockRejectedValue(new BusinessError("checksum mismatch"));

			const res = await restore.POST(req("POST", RESTORE_URL), versionParams);

			expect(res.status).toBe(422);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("keeps a write-ACL refusal as 403", async () => {
			const { ForbiddenError } = await import("@/lib/errors");
			mocks.restoreFileVersion.mockRejectedValue(new ForbiddenError("no write access"));
			const res = await restore.POST(req("POST", RESTORE_URL), versionParams);
			expect(res.status).toBe(403);
		});
	});

	describe("GET /api/files/[id]/versions", () => {
		it("returns the service's list for the entry in the URL", async () => {
			const res = await versions.GET(req("GET", LIST_URL), entryParams);
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json.versions).toHaveLength(1);
			expect(mocks.listFileVersions).toHaveBeenCalledWith({ fileEntryId: "file_1", session });
		});

		it("passes a 403 from the storage ACL through unchanged", async () => {
			const { ForbiddenError } = await import("@/lib/errors");
			mocks.listFileVersions.mockRejectedValue(new ForbiddenError("no read access"));

			const res = await versions.GET(req("GET", LIST_URL), entryParams);
			expect(res.status).toBe(403);
		});

		it("falls back to 500 for an unexpected service failure", async () => {
			mocks.listFileVersions.mockRejectedValue(new Error("db down"));
			const res = await versions.GET(req("GET", LIST_URL), entryParams);
			expect(res.status).toBe(500);
		});
	});

	describe("POST /api/files/[id]/versions", () => {
		it("creates a snapshot, returns 201 and audits it", async () => {
			const res = await versions.POST(req("POST", LIST_URL, { note: "before edit" }), entryParams);
			const json = await res.json();

			expect(res.status).toBe(201);
			expect(json.version).toMatchObject({ id: "ver_9", versionNumber: 3 });
			expect(mocks.createManualFileVersion).toHaveBeenCalledWith({
				fileEntryId: "file_1",
				session,
				note: "before edit",
			});
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"file.version.create",
				{ fileEntryId: "file_1", versionId: "ver_9", versionNumber: 3, reason: "MANUAL" },
				"INFO",
				"team_1",
			);
		});

		it("normalises a missing note to null", async () => {
			await versions.POST(req("POST", LIST_URL, {}), entryParams);
			expect(mocks.createManualFileVersion).toHaveBeenCalledWith(
				expect.objectContaining({ note: null }),
			);
		});

		it.each([
			["a note over 500 characters", { note: "x".repeat(501) }],
			["a non-string note", { note: 42 }],
		])("rejects %s", async (_label, body) => {
			const res = await versions.POST(req("POST", LIST_URL, body), entryParams);
			expect(res.status).toBe(400);
			expect(mocks.createManualFileVersion).not.toHaveBeenCalled();
		});

		it("does not audit when the snapshot fails", async () => {
			mocks.createManualFileVersion.mockRejectedValue(new Error("blob write failed"));
			const res = await versions.POST(req("POST", LIST_URL, {}), entryParams);
			// errorStatus 400: a failed snapshot is reported as a bad request, not a 500.
			expect(res.status).toBe(400);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});
	});
});
