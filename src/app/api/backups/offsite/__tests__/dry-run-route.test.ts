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

const mocks = vi.hoisted(() => ({ runOffsiteDryRun: vi.fn() }));
vi.mock("@/lib/storage/offsite/dry-run", () => ({ runOffsiteDryRun: mocks.runOffsiteDryRun }));

const { S3Error } = await import("@/lib/storage/offsite/s3-client");
const route = await import("../dry-run/route");
const post = () => route.POST(new Request("http://local/x", { method: "POST" }));

describe("POST /api/backups/offsite/dry-run", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession();
		mocks.runOffsiteDryRun.mockResolvedValue({ ok: true, bucket: "b", wrote: true });
	});

	it("is platform-only: a customer account cannot trigger it even with backup:create", async () => {
		routeSession.current = customerSession(["backup:create"]);
		expect((await post()).status).toBe(403);
		expect(mocks.runOffsiteDryRun).not.toHaveBeenCalled();
	});

	it("maps the dry-run outcome to 200, 422 for a failed check and 502 for an S3 error", async () => {
		expect((await post()).status).toBe(200);
		mocks.runOffsiteDryRun.mockResolvedValueOnce({ ok: false, reason: "bucket missing" });
		const failed = await post();
		expect(failed.status).toBe(422);
		expect(await failed.json()).toEqual({ ok: false, reason: "bucket missing" });
		mocks.runOffsiteDryRun.mockRejectedValueOnce(new S3Error("denied", 403, "AccessDenied"));
		const s3 = await post();
		expect(s3.status).toBe(502);
		expect(await s3.json()).toMatchObject({ error: "s3_error", code: "AccessDenied" });
	});
});
