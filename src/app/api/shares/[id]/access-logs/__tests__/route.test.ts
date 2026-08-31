import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/shares/[id]/access-logs
 *
 * Access logs carry visitor IPs and user agents, so the route must not widen the
 * audience of `listShareAccessLogs`: the service resolves the share under
 * `teamWhere(session)` and then requires the caller to be its creator or hold
 * `share:manage`. The route is a pass-through, so what is pinned here is that
 * the id from the URL and the caller's session both reach the service, and that
 * its 404/403 refusals keep their status.
 */
const mocks = vi.hoisted(() => ({
	listShareAccessLogs: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/share-link/service", () => ({ listShareAccessLogs: mocks.listShareAccessLogs }));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (_request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		try {
			return await handler({ session });
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

const route = await import("../route");

const logRow = {
	id: "log_1",
	shareLinkId: "share_1",
	action: "download",
	ipAddress: "203.0.113.7",
	userAgent: "curl/8.5.0",
	accessedAt: new Date("2026-08-30T09:00:00.000Z").toISOString(),
};

function get(id = "share_1") {
	return {
		req: new Request(`https://a.test/api/shares/${id}/access-logs`, { method: "GET" }),
		ctx: { params: Promise.resolve({ id }) },
	};
}

describe("GET /api/shares/[id]/access-logs", () => {
	beforeEach(() => {
		mocks.listShareAccessLogs.mockReset();
		mocks.guardCalls.length = 0;
		mocks.listShareAccessLogs.mockResolvedValue([logRow]);
	});

	it("requires share:read", async () => {
		const { req, ctx } = get();
		await route.GET(req, ctx);
		expect(mocks.guardCalls[0]).toMatchObject({ permission: "share:read" });
	});

	it("returns the logs for the share id in the URL", async () => {
		const { req, ctx } = get("share_42");
		const res = await route.GET(req, ctx);
		const json = await res.json();

		expect(res.status).toBe(200);
		expect(json.logs).toHaveLength(1);
		expect(mocks.listShareAccessLogs).toHaveBeenCalledWith("share_42", session);
	});

	it("returns an empty list rather than 404 for a share with no visits", async () => {
		mocks.listShareAccessLogs.mockResolvedValue([]);
		const { req, ctx } = get();
		const res = await route.GET(req, ctx);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ logs: [] });
	});

	it("keeps a 404 for a share outside the caller's team", async () => {
		const { NotFoundError } = await import("@/lib/errors");
		mocks.listShareAccessLogs.mockRejectedValue(new NotFoundError("share not found"));

		const { req, ctx } = get("share_other");
		const res = await route.GET(req, ctx);

		expect(res.status).toBe(404);
	});

	it("keeps a 403 when the caller neither owns the share nor manages shares", async () => {
		const { ForbiddenError } = await import("@/lib/errors");
		mocks.listShareAccessLogs.mockRejectedValue(new ForbiddenError("missing log permission"));

		const { req, ctx } = get();
		const res = await route.GET(req, ctx);

		expect(res.status).toBe(403);
	});

	it("falls back to 500 for an unexpected failure", async () => {
		mocks.listShareAccessLogs.mockRejectedValue(new Error("db down"));
		const { req, ctx } = get();
		const res = await route.GET(req, ctx);
		expect(res.status).toBe(500);
	});
});
