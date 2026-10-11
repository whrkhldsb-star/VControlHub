import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "@/lib/errors";
import { customerSession, routeSession } from "@/test/route-session-mock";

vi.mock("@/lib/auth/api-session", async () => {
	const { NextResponse } = await import("next/server");
	const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });
	return {
		getApiSession: vi.fn(async () => routeSession.current),
		requireApiSession: vi.fn(async () => routeSession.current ?? unauthenticated()),
		isSessionPayload: (value: unknown) => !(value instanceof Response),
	};
});
vi.mock("@/lib/http/rate-limit-presets", () => ({
	GENERAL_WRITE_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({
	listFileVersions: vi.fn(), createManualFileVersion: vi.fn(),
	getLocalEditableFileDraft: vi.fn(), saveLocalEditableFileDraft: vi.fn(),
	listFilePreferences: vi.fn(), updateFilePreference: vi.fn(), auditUserAction: vi.fn(),
}));
vi.mock("@/lib/storage/file-versions", async (original) => ({ ...((await original()) as Record<string, unknown>), listFileVersions: mocks.listFileVersions, createManualFileVersion: mocks.createManualFileVersion }));
vi.mock("@/lib/storage/service", async (original) => ({ ...((await original()) as Record<string, unknown>), getLocalEditableFileDraft: mocks.getLocalEditableFileDraft, saveLocalEditableFileDraft: mocks.saveLocalEditableFileDraft }));
vi.mock("@/lib/files/preferences", async (original) => ({ ...((await original()) as Record<string, unknown>), listFilePreferences: mocks.listFilePreferences, updateFilePreference: mocks.updateFilePreference }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const versions = await import("../[id]/versions/route");
const editable = await import("../editable/[id]/route");
const preferences = await import("../preferences/route");
const req = (method: string, url: string, body?: unknown) =>
	new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = Promise.resolve({ id: "file_1" });

describe("file version, editable draft and preference routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["storage:read", "storage:write"]);
		mocks.listFileVersions.mockResolvedValue([{ id: "v1" }]);
		mocks.createManualFileVersion.mockResolvedValue({ id: "v2", versionNumber: 2, reason: "manual" });
		mocks.getLocalEditableFileDraft.mockResolvedValue({ content: "hello", updatedAt: "2026-10-11T00:00:00.000Z" });
		mocks.saveLocalEditableFileDraft.mockResolvedValue({ id: "file_1", size: 5 });
		mocks.listFilePreferences.mockResolvedValue({ items: [] });
		mocks.updateFilePreference.mockResolvedValue({ fileEntryId: "file_1", favorite: true });
	});

	it("reads need storage:read and writes need storage:write", async () => {
		routeSession.current = customerSession([]);
		expect((await versions.GET(req("GET", "http://local/api/files/file_1/versions"), { params })).status).toBe(403);
		expect((await preferences.GET(req("GET", "http://local/api/files/preferences"))).status).toBe(403);
		routeSession.current = customerSession(["storage:read"]);
		expect((await versions.POST(req("POST", "http://local/api/files/file_1/versions", {}), { params })).status).toBe(403);
		expect((await editable.PUT(req("PUT", "http://local/api/files/editable/file_1", { content: "x" }), { params })).status).toBe(403);
		expect(mocks.createManualFileVersion).not.toHaveBeenCalled();
	});

	it("lists and snapshots versions inside the caller's scope with an audit row", async () => {
		expect(await (await versions.GET(req("GET", "http://local/api/files/file_1/versions"), { params })).json()).toEqual({ versions: [{ id: "v1" }] });
		expect(mocks.listFileVersions).toHaveBeenCalledWith({ fileEntryId: "file_1", session: expect.objectContaining({ currentTeamId: "team_1" }) });
		const created = await versions.POST(req("POST", "http://local/api/files/file_1/versions", { note: "before edit" }), { params });
		expect(created.status).toBe(201);
		expect(mocks.createManualFileVersion).toHaveBeenCalledWith({ fileEntryId: "file_1", session: expect.anything(), note: "before edit" });
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "file.version.create", expect.objectContaining({ fileEntryId: "file_1", versionId: "v2", versionNumber: 2 }), "INFO", "team_1");
		mocks.listFileVersions.mockRejectedValueOnce(new NotFoundError("gone"));
		expect((await versions.GET(req("GET", "http://local/api/files/file_1/versions"), { params })).status).toBe(404);
	});

	it("saves an editable draft with its optimistic-concurrency stamps and surfaces a conflict", async () => {
		expect(await (await editable.GET(req("GET", "http://local/api/files/editable/file_1"), { params })).json()).toMatchObject({ draft: { content: "hello" } });
		const saved = await editable.PUT(req("PUT", "http://local/api/files/editable/file_1", { content: "hello world", expectedUpdatedAt: "2026-10-11T00:00:00.000Z" }), { params });
		expect(saved.status).toBe(200);
		expect(mocks.saveLocalEditableFileDraft).toHaveBeenCalledWith(expect.objectContaining({ fileEntryId: "file_1", content: "hello world", expectedUpdatedAt: "2026-10-11T00:00:00.000Z" }));
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "file.edit", { fileId: "file_1" }, undefined, "team_1");
		mocks.saveLocalEditableFileDraft.mockRejectedValueOnce(new ConflictError("changed on disk"));
		expect((await editable.PUT(req("PUT", "http://local/api/files/editable/file_1", { content: "x" }), { params })).status).toBe(409);
	});

	it("preferences are per user, never cached, and validated", async () => {
		const res = await preferences.GET(req("GET", "http://local/api/files/preferences?mode=recent"));
		expect(res.headers.get("cache-control")).toContain("no-store");
		expect(mocks.listFilePreferences).toHaveBeenCalledWith(expect.objectContaining({ userId: "u_cust" }), expect.objectContaining({ mode: "recent" }));
		expect((await preferences.GET(req("GET", "http://local/api/files/preferences?mode=bogus"))).status).toBe(400);
		const updated = await preferences.PATCH(req("PATCH", "http://local/api/files/preferences", { fileEntryId: "file_1", favorite: true }));
		expect(updated.status).toBe(200);
		expect(mocks.updateFilePreference).toHaveBeenCalledWith(expect.objectContaining({ userId: "u_cust" }), { fileEntryId: "file_1", favorite: true });
		expect((await preferences.PATCH(req("PATCH", "http://local/api/files/preferences", { favorite: true }))).status).toBe(400);
	});
});
