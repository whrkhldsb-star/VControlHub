import { beforeEach, describe, expect, it, vi } from "vitest";

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

const mocks = vi.hoisted(() => ({ appendMediaUploadChunk: vi.fn() }));
vi.mock("@/lib/upload/service", async (original) => ({ ...((await original()) as Record<string, unknown>), appendMediaUploadChunk: mocks.appendMediaUploadChunk }));

const chunk = await import("../upload/[id]/chunk/route");
const put = (query: string, body: string) => chunk.PUT(new Request(`http://local/api/images/upload/up_1/chunk${query}`, { method: "PUT", body }), { params: Promise.resolve({ id: "up_1" }) });

describe("PUT /api/images/upload/[id]/chunk", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["storage:write"]);
		mocks.appendMediaUploadChunk.mockResolvedValue({ id: "up_1", receivedChunks: 1 });
	});

	it("needs storage:write and a well-formed index and size", async () => {
		routeSession.current = customerSession(["storage:read"]);
		expect((await put("?index=0&size=5", "hello")).status).toBe(403);
		routeSession.current = customerSession(["storage:write"]);
		expect((await put("?index=-1&size=5", "hello")).status).toBe(400);
		expect((await put("", "hello")).status).toBe(400);
		expect(mocks.appendMediaUploadChunk).not.toHaveBeenCalled();
	});

	it("appends a chunk for the caller's own session and refuses one larger than declared", async () => {
		const res = await put("?index=0&size=5", "hello");
		expect(res.status).toBe(200);
		expect(mocks.appendMediaUploadChunk).toHaveBeenCalledWith(expect.objectContaining({ sessionId: "up_1", userId: "u_cust", index: 0, size: 5 }));
		expect((mocks.appendMediaUploadChunk.mock.calls[0]?.[0] as { buffer: Buffer }).buffer.toString()).toBe("hello");
		expect((await put("?index=0&size=5", "hello world")).status).toBe(413);
	});
});
