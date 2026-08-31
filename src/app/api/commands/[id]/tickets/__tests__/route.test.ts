import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /api/commands/[id]/tickets
 *
 * The reverse link from a command request to its tickets. `listTicketsForCommand`
 * applies the ticket team filter, so the session has to travel with the id;
 * the route then projects a fixed field set — ticket descriptions and comments
 * must not ride along in a list meant for a link widget.
 */
const mocks = vi.hoisted(() => ({
	listTicketsForCommand: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/ticket/timeline", () => ({
	listTicketsForCommand: mocks.listTicketsForCommand,
}));

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

function get(id = "cmd_1") {
	return {
		req: new Request(`https://a.test/api/commands/${id}/tickets`, { method: "GET" }),
		ctx: { params: Promise.resolve({ id }) },
	};
}

describe("GET /api/commands/[id]/tickets", () => {
	beforeEach(() => {
		mocks.listTicketsForCommand.mockReset();
		mocks.guardCalls.length = 0;
		mocks.listTicketsForCommand.mockResolvedValue([]);
	});

	it("requires command:read behind a read limit", async () => {
		const { req, ctx } = get();
		await route.GET(req, ctx);
		expect(mocks.guardCalls[0]).toMatchObject({
			permission: "command:read",
			rateLimit: { maxRequests: 120, windowMs: 60_000 },
		});
	});

	it("passes the id and session to the scoped query", async () => {
		const { req, ctx } = get("cmd_42");
		await route.GET(req, ctx);
		expect(mocks.listTicketsForCommand).toHaveBeenCalledWith("cmd_42", session);
	});

	it("projects only the link fields, dropping ticket bodies", async () => {
		mocks.listTicketsForCommand.mockResolvedValue([
			{
				id: "tkt_1",
				title: "Restart nginx",
				status: "OPEN",
				priority: "HIGH",
				updatedAt: new Date("2026-08-30T12:00:00.000Z"),
				description: "internal notes that should not travel",
			},
		]);

		const { req, ctx } = get();
		const res = await route.GET(req, ctx);
		const json = await res.json();

		expect(res.status).toBe(200);
		expect(json).toEqual({
			commandRequestId: "cmd_1",
			tickets: [
				{
					id: "tkt_1",
					title: "Restart nginx",
					status: "OPEN",
					priority: "HIGH",
					updatedAt: "2026-08-30T12:00:00.000Z",
				},
			],
		});
	});

	it("returns an empty list for a command with no linked tickets", async () => {
		const { req, ctx } = get();
		const res = await route.GET(req, ctx);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ commandRequestId: "cmd_1", tickets: [] });
	});

	it("falls back to 500 for an unexpected failure", async () => {
		mocks.listTicketsForCommand.mockRejectedValue(new Error("db down"));
		const { req, ctx } = get();
		expect((await route.GET(req, ctx)).status).toBe(500);
	});
});
