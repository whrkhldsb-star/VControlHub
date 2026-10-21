import { NextResponse } from "next/server";
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
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ findFirst: vi.fn(), access: vi.fn(), respond: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { fileEntry: { findFirst: mocks.findFirst } } }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: mocks.access }));
vi.mock("@/lib/storage/thumbnail-response", () => ({ respondWithStorageThumbnail: mocks.respond }));

const route = await import("../thumbnail/route");
const get = (id = "file_1") => route.GET(new Request(`http://local/api/files/${id}/thumbnail`), { params: Promise.resolve({ id }) });
const node = { id: "node_1", driver: "LOCAL", basePath: "/srv/files" };

describe("GET /api/files/[id]/thumbnail", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["storage:read"]);
		mocks.findFirst.mockResolvedValue({ id: "file_1", mimeType: "image/png", relativePath: "pics//a.png", updatedAt: new Date("2026-10-21T00:00:00Z"), storageNode: node });
		mocks.access.mockResolvedValue({ allowed: true });
		mocks.respond.mockResolvedValue(new NextResponse("jpeg", { headers: { "Content-Type": "image/jpeg" } }));
	});

	it("needs storage:read", async () => {
		routeSession.current = customerSession([]);
		expect((await get()).status).toBe(403);
		expect(mocks.findFirst).not.toHaveBeenCalled();
	});

	it("only finds live files of the caller's customer", async () => {
		mocks.findFirst.mockResolvedValue(null);
		expect((await get()).status).toBe(404);
		expect(mocks.findFirst).toHaveBeenCalledWith(expect.objectContaining({
			where: expect.objectContaining({ id: "file_1", isDeleted: false, entryType: "FILE", storageNode: expect.objectContaining({ teamId: "team_1" }) }),
		}));
		expect(mocks.respond).not.toHaveBeenCalled();
	});

	it("refuses types without a thumbnail", async () => {
		mocks.findFirst.mockResolvedValue({ id: "file_1", mimeType: "application/pdf", relativePath: "a.pdf", updatedAt: null, storageNode: node });
		expect((await get()).status).toBe(415);
		expect(mocks.respond).not.toHaveBeenCalled();
	});

	it("applies path grants on the normalized path", async () => {
		mocks.access.mockResolvedValue({ allowed: false, reason: "path" });
		expect((await get()).status).toBe(403);
		expect(mocks.access).toHaveBeenCalledWith(expect.objectContaining({ storageNodeId: "node_1", relativePath: "pics/a.png", operation: "read" }));
		expect(mocks.respond).not.toHaveBeenCalled();
	});

	it("answers with the shared thumbnail and no placeholder tile", async () => {
		const response = await get();
		expect(response.status).toBe(200);
		expect(mocks.respond).toHaveBeenCalledWith({
			id: "file_1",
			updatedAt: new Date("2026-10-21T00:00:00Z"),
			relativePath: "pics/a.png",
			node,
			placeholder: false,
		});
	});
});
