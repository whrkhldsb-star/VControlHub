import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/files/search-content
 *
 * The route is a thin shell over `searchFileContents`, which applies
 * `teamWhere(session)` to the storage-node query — so the one thing that must
 * never regress here is that the session reaches the service. A call that
 * dropped it would silently search every tenant's nodes, because the service
 * treats a missing session as "no team filter". The grep/snippet behaviour is
 * covered by `src/lib/files/__tests__/content-search.test.ts`.
 */
const mocks = vi.hoisted(() => ({
	searchFileContents: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/files/content-search", () => ({ searchFileContents: mocks.searchFileContents }));

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

const emptyResponse = { results: [], totalMatches: 0, truncated: false };

function get(query: string) {
	return new Request(`https://a.test/api/files/search-content${query}`, {
		method: "GET",
	}) as never;
}

describe("GET /api/files/search-content", () => {
	beforeEach(() => {
		mocks.searchFileContents.mockReset();
		mocks.guardCalls.length = 0;
		mocks.searchFileContents.mockResolvedValue(emptyResponse);
	});

	it("requires storage:read", async () => {
		await route.GET(get("?q=needle"));
		expect(mocks.guardCalls[0]).toMatchObject({ permission: "storage:read" });
	});

	it("forwards the session so the node query stays team-scoped", async () => {
		await route.GET(get("?q=needle"));
		expect(mocks.searchFileContents).toHaveBeenCalledWith(
			expect.objectContaining({ query: "needle", session }),
		);
	});

	it("returns the service response verbatim", async () => {
		mocks.searchFileContents.mockResolvedValue({
			results: [
				{
					nodeId: "node_1",
					relativePath: "docs/notes.txt",
					matches: [{ line: 12, text: "needle in a haystack" }],
				},
			],
			totalMatches: 1,
			truncated: true,
		});

		const res = await route.GET(get("?q=needle"));
		const json = await res.json();

		expect(res.status).toBe(200);
		expect(json.totalMatches).toBe(1);
		expect(json.truncated).toBe(true);
		expect(json.results[0].relativePath).toBe("docs/notes.txt");
	});

	it("passes nodeId and path filters through", async () => {
		await route.GET(get("?q=needle&nodeId=node_2&path=docs/sub"));
		expect(mocks.searchFileContents).toHaveBeenCalledWith({
			query: "needle",
			nodeId: "node_2",
			searchPath: "docs/sub",
			session,
		});
	});

	it("leaves the optional filters undefined when absent", async () => {
		await route.GET(get("?q=needle"));
		const args = mocks.searchFileContents.mock.calls[0]?.[0] as Record<string, unknown>;
		expect(args.nodeId).toBeUndefined();
		expect(args.searchPath).toBeUndefined();
	});

	it("trims the query before searching", async () => {
		await route.GET(get(`?q=${encodeURIComponent("  needle  ")}`));
		expect(mocks.searchFileContents).toHaveBeenCalledWith(
			expect.objectContaining({ query: "needle" }),
		);
	});

	it.each([
		["a missing q", ""],
		["a blank q", "?q="],
		["a whitespace-only q", `?q=${encodeURIComponent("   ")}`],
		["a q over 200 characters", `?q=${"x".repeat(201)}`],
		["a blank nodeId", "?q=needle&nodeId="],
	])("rejects %s with 400 and never searches", async (_label, query) => {
		const res = await route.GET(get(query));
		expect(res.status).toBe(400);
		expect(mocks.searchFileContents).not.toHaveBeenCalled();
	});

	it("falls back to 500 when the search itself fails", async () => {
		mocks.searchFileContents.mockRejectedValue(new Error("sftp timeout"));
		const res = await route.GET(get("?q=needle"));
		expect(res.status).toBe(500);
	});
});
