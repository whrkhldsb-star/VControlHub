import { beforeEach, describe, expect, it, vi } from "vitest";

import { platformSession, routeSession } from "@/test/route-session-mock";

/**
 * Through the real withApiRoute: the route declared no body schema, so the
 * wrapper never read the body. "Node A only, dry run" ran for real over every
 * node in reach, and a queued job kept none of its settings.
 */
vi.mock("@/lib/auth/api-session", async () => {
	const { NextResponse } = await import("next/server");
	return {
		getApiSession: vi.fn(async () => routeSession.current),
		requireApiSession: vi.fn(async () => routeSession.current ?? NextResponse.json({ error: "unauthenticated" }, { status: 401 })),
		isSessionPayload: (value: unknown) => !(value instanceof Response),
	};
});
vi.mock("@/lib/http/rate-limit-presets", () => ({
	GENERAL_WRITE_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));
const mocks = vi.hoisted(() => ({ find: vi.fn(), list: vi.fn(), detect: vi.fn(), enqueue: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/storage/sftp-stale-inventory", () => ({ findSftpNodeForStaleInventory: mocks.find, listSftpNodesForStaleInventory: mocks.list, detectAndPruneSftpStaleInventory: mocks.detect }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueue }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.audit }));

const route = await import("../route");
const post = (body: unknown, query = "") => route.POST(new Request(`http://local/api/storage/sftp-stale-inventory${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }) as never);

describe("POST /api/storage/sftp-stale-inventory body", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession();
		mocks.find.mockResolvedValue({ id: "node_a", name: "a", driver: "SFTP" });
		mocks.list.mockResolvedValue([{ id: "node_a" }, { id: "node_b" }]);
		mocks.detect.mockImplementation(async (input: { node: { id: string }; dryRun?: boolean }) => ({ nodeId: input.node.id, dryRun: Boolean(input.dryRun), scanned: 1, stale: 1, pruned: 0, errors: [] }));
		mocks.enqueue.mockResolvedValue({ id: "job_1", status: "PENDING" });
	});

	it("runs a dry run of the named node only", async () => {
		const response = await post({ nodeId: "node_a", dryRun: true, maxDepth: 0, reason: "check" }, "?wait=1");
		expect(response.status).toBe(200);
		expect(mocks.detect).toHaveBeenCalledTimes(1);
		expect(mocks.detect).toHaveBeenCalledWith(expect.objectContaining({ node: expect.objectContaining({ id: "node_a" }), dryRun: true, maxDepth: 0 }));
	});

	it("queues the job with its settings", async () => {
		expect((await post({ nodeId: "node_a", dryRun: true, maxDepth: 2, reason: "check" })).status).toBe(202);
		expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ nodeId: "node_a", dryRun: true, maxDepth: 2, reason: "check" }) }));
	});

	it("still accepts an empty body for every node in reach", async () => {
		expect((await post(undefined)).status).toBe(202);
	});
});
