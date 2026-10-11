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
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ runPlaybook: vi.fn(), listPlaybookRuns: vi.fn() }));
vi.mock("@/lib/playbook/service", () => ({ runPlaybook: mocks.runPlaybook, listPlaybookRuns: mocks.listPlaybookRuns }));

const run = await import("../[id]/run/route");
const dryRun = await import("../[id]/dry-run/route");
const runs = await import("../[id]/runs/route");
const params = Promise.resolve({ id: "pb_1" });
const post = (path: string) => new Request(`http://local/api/playbooks/pb_1/${path}`, { method: "POST" });

describe("playbook run routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["playbook:run", "playbook:read"]);
		mocks.runPlaybook.mockResolvedValue({ id: "run_1", status: "QUEUED" });
		mocks.listPlaybookRuns.mockResolvedValue([{ id: "run_1" }]);
	});

	it("run and dry-run need playbook:run; the run list needs playbook:read", async () => {
		routeSession.current = customerSession(["playbook:read"]);
		expect((await run.POST(post("run"), { params })).status).toBe(403);
		expect((await dryRun.POST(post("dry-run"), { params })).status).toBe(403);
		routeSession.current = customerSession(["playbook:run"]);
		expect((await runs.GET(new Request("http://local/api/playbooks/pb_1/runs"), { params })).status).toBe(403);
		expect(mocks.runPlaybook).not.toHaveBeenCalled();
	});

	it("queues a real run and a dry run with the caller's scope and trigger context", async () => {
		const queued = await run.POST(post("run"), { params });
		expect(queued.status).toBe(202);
		expect(mocks.runPlaybook).toHaveBeenCalledWith(expect.objectContaining({
			playbookId: "pb_1", dryRun: false, createdById: "u_cust",
			triggerContext: expect.objectContaining({ source: "manual", userId: "u_cust" }),
			session: expect.objectContaining({ currentTeamId: "team_1" }),
		}));
		const rehearsal = await dryRun.POST(post("dry-run"), { params });
		expect(rehearsal.status).toBe(202);
		expect(mocks.runPlaybook).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: true, triggerContext: expect.objectContaining({ source: "dry-run" }) }));
	});

	it("refuses a blank id and maps a missing playbook to 404", async () => {
		expect((await run.POST(post("run"), { params: Promise.resolve({ id: " " }) })).status).toBe(400);
		mocks.listPlaybookRuns.mockRejectedValueOnce(new NotFoundError("missing"));
		expect((await runs.GET(new Request("http://local/api/playbooks/pb_1/runs"), { params })).status).toBe(404);
		expect(await (await runs.GET(new Request("http://local/api/playbooks/pb_1/runs"), { params })).json()).toEqual({ runs: [{ id: "run_1" }] });
		expect(mocks.listPlaybookRuns).toHaveBeenCalledWith("pb_1", expect.objectContaining({ userId: "u_cust" }));
	});
});
