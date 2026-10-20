import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/lib/errors";
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
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ restoreFileVersion: vi.fn(), auditUserAction: vi.fn() }));
vi.mock("@/lib/storage/file-versions", () => ({ restoreFileVersion: mocks.restoreFileVersion }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../versions/[versionId]/restore/route");
const params = Promise.resolve({ id: "file_1", versionId: "v_3" });
const post = () => route.POST(new Request("http://local/api/files/file_1/versions/v_3/restore", { method: "POST" }), { params });

describe("POST /api/files/[id]/versions/[versionId]/restore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["storage:write"]);
		mocks.restoreFileVersion.mockResolvedValue({ restored: { id: "v_3", versionNumber: 3 }, newRestorePoint: { id: "v_4" } });
	});

	it("needs storage:write", async () => {
		routeSession.current = customerSession(["storage:read"]);
		expect((await post()).status).toBe(403);
		expect(mocks.restoreFileVersion).not.toHaveBeenCalled();
	});

	it("restores inside the caller's scope, records the restore point and audits as a warning", async () => {
		const res = await post();
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ success: true, restored: { versionNumber: 3 }, restorePoint: { id: "v_4" } });
		expect(mocks.restoreFileVersion).toHaveBeenCalledWith({ fileEntryId: "file_1", versionId: "v_3", session: expect.objectContaining({ userId: "u_cust", currentTeamId: "team_1" }), allowWithoutRestorePoint: false });
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "file.version.restore", expect.objectContaining({ fileEntryId: "file_1", versionId: "v_3", restoredVersionNumber: 3, restorePointId: "v_4" }), "WARNING", "team_1");
	});

	it("answers 404 for a version the caller cannot see, without an audit row", async () => {
		mocks.restoreFileVersion.mockRejectedValue(new NotFoundError("missing"));
		expect((await post()).status).toBe(404);
		expect(mocks.auditUserAction).not.toHaveBeenCalled();
	});
});
