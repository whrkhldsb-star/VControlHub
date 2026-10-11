import { beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/lib/errors";
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
	UPLOAD_CHUNK_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ completeStorageFileUpload: vi.fn(), auditUserAction: vi.fn(), getStorageFileNode: vi.fn(), assertStorageAccess: vi.fn(), fileEntryFindFirst: vi.fn() }));
vi.mock("@/lib/storage/resumable-upload", async (original) => ({ ...((await original()) as Record<string, unknown>), completeStorageFileUpload: mocks.completeStorageFileUpload }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/db", () => ({ prisma: { fileEntry: { findFirst: mocks.fileEntryFindFirst } } }));

const complete = await import("../upload/[id]/complete/route");

describe("POST /api/storage/upload/[id]/complete", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["storage:write"]);
		mocks.completeStorageFileUpload.mockResolvedValue({ session: { id: "up_1", status: "COMPLETED" }, relativePath: "docs/a.txt", size: 12, storageNodeId: "node_1" });
	});

	it("needs storage:write", async () => {
		routeSession.current = customerSession(["storage:read"]);
		expect((await complete.POST(new Request("http://local/x", { method: "POST" }), { params: Promise.resolve({ id: "up_1" }) })).status).toBe(403);
		expect(mocks.completeStorageFileUpload).not.toHaveBeenCalled();
	});

	it("finalises the caller's own session, indexes it and audits the result", async () => {
		const res = await complete.POST(new Request("http://local/x", { method: "POST" }), { params: Promise.resolve({ id: "up_1" }) });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ session: { id: "up_1", status: "COMPLETED" }, relativePath: "docs/a.txt", size: 12, storageNodeId: "node_1" });
		expect(mocks.completeStorageFileUpload).toHaveBeenCalledWith({ sessionId: "up_1", session: expect.objectContaining({ userId: "u_cust", currentTeamId: "team_1" }) });
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "storage.upload.complete", expect.objectContaining({ sessionId: "up_1", storageNodeId: "node_1", size: 12 }), "INFO", "team_1");
		mocks.completeStorageFileUpload.mockRejectedValueOnce(new ValidationError("missing chunks"));
		expect((await complete.POST(new Request("http://local/x", { method: "POST" }), { params: Promise.resolve({ id: "up_1" }) })).status).toBe(400);
	});
});
