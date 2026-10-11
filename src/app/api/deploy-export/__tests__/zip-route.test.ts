import { beforeEach, describe, expect, it, vi } from "vitest";

import { customerSession, platformSession, routeSession } from "@/test/route-session-mock";

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

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), auditUserAction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { deploymentExport: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../[id]/zip/route");
const get = (id = "exp_1") => route.GET(new Request("http://local/x"), { params: Promise.resolve({ id }) });
const record = { id: "exp_1", name: "shop", createdBy: "u_cust", createdAt: new Date("2026-10-01T00:00:00Z"), manifest: { appName: "shop-app" }, files: { "docker-compose.yml": "services: {}", "install.sh": "#!/bin/sh", "manifest.json": { a: 1 }, skipped: 42 } };

describe("GET /api/deploy-export/[id]/zip", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["deploy:export"]);
		mocks.findUnique.mockResolvedValue(record);
	});

	it("needs deploy:export and hides packages the caller neither owns nor manages", async () => {
		routeSession.current = customerSession(["deploy:read"]);
		expect((await get()).status).toBe(403);
		routeSession.current = customerSession(["deploy:export"], { userId: "u_other" });
		expect((await get()).status).toBe(404);
		routeSession.current = platformSession();
		expect((await get()).status).toBe(200);
		mocks.findUnique.mockResolvedValueOnce(null);
		expect((await get("nope")).status).toBe(404);
		expect((await get("  ")).status).toBe(400);
	});

	it("zips the string-like files with the manifest app name and audits the download", async () => {
		const res = await get();
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toBe("application/zip");
		expect(res.headers.get("content-disposition")).toContain("shop-app-portable.zip");
		const bytes = Buffer.from(await res.arrayBuffer());
		expect(bytes.subarray(0, 2).toString()).toBe("PK");
		expect(res.headers.get("content-length")).toBe(String(bytes.length));
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "deployment.export.download", expect.objectContaining({ exportId: "exp_1", fileCount: 3 }), undefined, "team_1");
		mocks.findUnique.mockResolvedValueOnce({ ...record, files: { skipped: 42 } });
		expect((await get()).status).toBe(404);
	});
});
