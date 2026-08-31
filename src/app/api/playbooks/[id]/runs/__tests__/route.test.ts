import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/playbooks/[id]/runs
 *
 * Run history contains rendered command text and target server ids, so the
 * session must reach `listPlaybookRuns` — it re-resolves the parent playbook
 * under the caller's scope before listing, and treats a missing session as
 * "unscoped". The route's other job is rejecting a missing id before any query.
 */
const mocks = vi.hoisted(() => ({
	listPlaybookRuns: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/playbook/service", () => ({ listPlaybookRuns: mocks.listPlaybookRuns }));

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

function get(id?: string) {
	return {
		req: new Request(`https://a.test/api/playbooks/${id ?? ""}/runs`, { method: "GET" }),
		ctx: { params: Promise.resolve(id === undefined ? {} : { id }) },
	};
}

const runRow = { id: "run_1", playbookId: "pb_1", status: "SUCCEEDED", createdAt: "2026-08-30T00:00:00.000Z" };

describe("GET /api/playbooks/[id]/runs", () => {
	beforeEach(() => {
		mocks.listPlaybookRuns.mockReset();
		mocks.guardCalls.length = 0;
		mocks.listPlaybookRuns.mockResolvedValue([runRow]);
	});

	it("requires playbook:read behind a read limit", async () => {
		const { req, ctx } = get("pb_1");
		await route.GET(req, ctx);
		expect(mocks.guardCalls[0]).toMatchObject({
			permission: "playbook:read",
			rateLimit: { maxRequests: 120, windowMs: 60_000 },
		});
	});

	it("lists the runs for the playbook in the URL, with the session attached", async () => {
		const { req, ctx } = get("pb_42");
		const res = await route.GET(req, ctx);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ runs: [runRow] });
		expect(mocks.listPlaybookRuns).toHaveBeenCalledWith("pb_42", session);
	});

	it("rejects a missing id before querying anything", async () => {
		const { req, ctx } = get(undefined);
		const res = await route.GET(req, ctx);

		expect(res.status).toBeGreaterThanOrEqual(400);
		expect(mocks.listPlaybookRuns).not.toHaveBeenCalled();
	});

	it("keeps a 404 for a playbook outside the caller's scope", async () => {
		const { NotFoundError } = await import("@/lib/errors");
		mocks.listPlaybookRuns.mockRejectedValue(new NotFoundError("playbook not found"));

		const { req, ctx } = get("pb_other");
		const res = await route.GET(req, ctx);

		expect(res.status).toBe(404);
	});

	it("falls back to 500 for an unexpected failure", async () => {
		mocks.listPlaybookRuns.mockRejectedValue(new Error("db down"));
		const { req, ctx } = get("pb_1");
		expect((await route.GET(req, ctx)).status).toBe(500);
	});
});
