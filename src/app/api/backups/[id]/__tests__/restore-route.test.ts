import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessError, NotFoundError } from "@/lib/errors";
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
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({
	prepareOfflineRestore: vi.fn(),
	enqueueJob: vi.fn(),
	auditUserAction: vi.fn(),
}));
vi.mock("@/lib/backup/service", () => ({ prepareOfflineRestore: mocks.prepareOfflineRestore }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../restore/route");
const params = Promise.resolve({ id: "bk_1" });
const post = (body: unknown, query = "") =>
	route.POST(new Request(`http://local/api/backups/bk_1/restore${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params });

const plan = {
	id: "bk_1",
	type: "FULL",
	component: "database",
	filePath: "backups/full.tar.gz",
	checksumSha256: "a".repeat(64),
	checksumVerifiedAt: "2026-10-13T00:00:00.000Z",
	commands: { stopServices: "sudo systemctl stop vcontrolhub-next", safetySnapshot: "snap", restore: "restore", startServices: "start" },
};

describe("POST /api/backups/[id]/restore (offline restore plan)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession({ permissions: ["backup:restore"] });
		mocks.prepareOfflineRestore.mockResolvedValue(plan);
	});

	it("is refused without backup:restore", async () => {
		routeSession.current = customerSession(["backup:read"]);
		const res = await post({ component: "database" });
		expect(res.status).toBe(403);
		expect(mocks.prepareOfflineRestore).not.toHaveBeenCalled();
	});

	it("returns the verified offline runbook and never queues or runs a restore", async () => {
		const res = await post({ component: "database" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ offlineRestore: plan });
		expect(mocks.prepareOfflineRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "bk_1", component: "database" }));
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_admin", "backup.restore_plan", { backupId: "bk_1", component: "database" }, undefined, null);
	});

	it("ignores the legacy wait=1 / confirm inputs: there is no in-app restore any more", async () => {
		const res = await post({ confirm: "RESTORE" }, "?wait=1");
		expect(res.status).toBe(200);
		expect(await res.json()).toHaveProperty("offlineRestore");
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
	});

	it("keeps typed error statuses (out-of-scope backup is 404, checksum mismatch is 422)", async () => {
		mocks.prepareOfflineRestore.mockRejectedValueOnce(new NotFoundError("backup not found"));
		expect((await post({})).status).toBe(404);
		mocks.prepareOfflineRestore.mockRejectedValueOnce(new BusinessError("checksum mismatch"));
		expect((await post({})).status).toBe(422);
		expect(mocks.auditUserAction).not.toHaveBeenCalled();
	});

	it("rejects an unknown component", async () => {
		expect((await post({ component: "everything" })).status).toBe(400);
		expect(mocks.prepareOfflineRestore).not.toHaveBeenCalled();
	});
});
