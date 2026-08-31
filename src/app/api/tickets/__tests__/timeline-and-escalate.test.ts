import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the two untested ticket routes.
 *
 * The timeline route's own guard is `ticket:read`/`ticket:manage`, but the real
 * gate is `assertCanAccess`: it resolves the ticket through `getTicketById`
 * (team-scoped) *before* consulting `canViewTicket`, so `ticket:manage` cannot
 * be used as a cross-tenant superpower. The SLA route decides scope from the
 * session: a platform manager sweeps every team, everyone else only their own.
 */
const mocks = vi.hoisted(() => ({
	getTicketById: vi.fn(),
	canViewTicket: vi.fn(),
	getTicketTimeline: vi.fn(),
	linkTicketCommand: vi.fn(),
	linkTicketServer: vi.fn(),
	escalateBreachedTickets: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/ticket/service", () => ({
	getTicketById: mocks.getTicketById,
	canViewTicket: mocks.canViewTicket,
}));
vi.mock("@/lib/ticket/timeline", () => ({
	getTicketTimeline: mocks.getTicketTimeline,
	linkTicketCommand: mocks.linkTicketCommand,
	linkTicketServer: mocks.linkTicketServer,
}));
vi.mock("@/lib/ticket/sla", () => ({ escalateBreachedTickets: mocks.escalateBreachedTickets }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

let currentSession: Record<string, unknown> = {};

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) return Response.json({ error: "输入参数无效" }, { status: 400 });
			body = parsed.data;
		}
		try {
			return await handler({ session: currentSession, body });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
			const status = (error as { status?: number }).status ?? options.errorStatus ?? 500;
			return Response.json({ error: (error as Error).message }, { status });
		}
	}),
}));

const reporter = {
	userId: "u_1",
	username: "reporter",
	roles: ["viewer"],
	permissions: ["ticket:read"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const ticketManager = {
	userId: "u_2",
	username: "op",
	roles: ["operator"],
	permissions: ["ticket:read", "ticket:manage"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const platformManager = {
	userId: "u_3",
	username: "root",
	roles: ["admin"],
	permissions: ["ticket:read", "ticket:manage", "team:manage"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const timeline = await import("../[id]/timeline/route");
const escalate = await import("../sla/escalate/route");

const idParams = { params: Promise.resolve({ id: "tkt_1" }) };

function req(method: string, body?: unknown) {
	return new Request("https://a.test/api/tickets/tkt_1/timeline", {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const timelineView = { ticketId: "tkt_1", events: [], relatedCommandId: null, serverId: null };

describe("ticket timeline + SLA escalation routes", () => {
	beforeEach(() => {
		for (const stub of [
			mocks.getTicketById,
			mocks.canViewTicket,
			mocks.getTicketTimeline,
			mocks.linkTicketCommand,
			mocks.linkTicketServer,
			mocks.escalateBreachedTickets,
			mocks.auditUserAction,
		]) {
			stub.mockReset();
		}
		mocks.guardCalls.length = 0;
		currentSession = ticketManager;
		mocks.getTicketById.mockResolvedValue({ id: "tkt_1", teamId: "team_1" });
		mocks.canViewTicket.mockResolvedValue(true);
		mocks.getTicketTimeline.mockResolvedValue(timelineView);
		mocks.linkTicketCommand.mockResolvedValue(undefined);
		mocks.linkTicketServer.mockResolvedValue(undefined);
		mocks.escalateBreachedTickets.mockResolvedValue(3);
	});

	describe("GET timeline", () => {
		it("requires ticket:read behind a read limit", async () => {
			await timeline.GET(req("GET"), idParams);
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "ticket:read",
				rateLimit: { maxRequests: 120, windowMs: 60_000 },
			});
		});

		it("returns the timeline for an accessible ticket", async () => {
			const res = await timeline.GET(req("GET"), idParams);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual(timelineView);
			expect(mocks.getTicketTimeline).toHaveBeenCalledWith("tkt_1", ticketManager);
		});

		it("403s a ticket outside the caller's team even for ticket:manage", async () => {
			// getTicketById is team-scoped; a null means "not in your tenant".
			mocks.getTicketById.mockResolvedValue(null);

			const res = await timeline.GET(req("GET"), idParams);

			expect(res.status).toBe(403);
			expect(mocks.canViewTicket).not.toHaveBeenCalled();
			expect(mocks.getTicketTimeline).not.toHaveBeenCalled();
		});

		it("403s a reporter who is not a participant on the ticket", async () => {
			currentSession = reporter;
			mocks.canViewTicket.mockResolvedValue(false);

			const res = await timeline.GET(req("GET"), idParams);

			expect(res.status).toBe(403);
			expect(mocks.getTicketTimeline).not.toHaveBeenCalled();
		});

		it("lets a participating reporter through", async () => {
			currentSession = reporter;
			mocks.canViewTicket.mockResolvedValue(true);

			const res = await timeline.GET(req("GET"), idParams);

			expect(res.status).toBe(200);
			expect(mocks.canViewTicket).toHaveBeenCalledWith("tkt_1", "u_1", reporter);
		});
	});

	describe("POST timeline", () => {
		it("requires ticket:manage behind a write limit", async () => {
			await timeline.POST(req("POST", { action: "unlink_command" }), idParams);
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "ticket:manage",
				rateLimit: { maxRequests: 30, windowMs: 60_000 },
			});
		});

		it("re-checks ticket access before linking", async () => {
			mocks.getTicketById.mockResolvedValue(null);

			const res = await timeline.POST(
				req("POST", { action: "link_command", commandRequestId: "cmd_1" }),
				idParams,
			);

			expect(res.status).toBe(403);
			expect(mocks.linkTicketCommand).not.toHaveBeenCalled();
		});

		it("links a command and audits it", async () => {
			const res = await timeline.POST(
				req("POST", { action: "link_command", commandRequestId: "cmd_1" }),
				idParams,
			);

			expect(res.status).toBe(200);
			expect(mocks.linkTicketCommand).toHaveBeenCalledWith({
				ticketId: "tkt_1",
				commandRequestId: "cmd_1",
				actorId: "u_2",
				session: ticketManager,
			});
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_2",
				"ticket.link_command",
				{ ticketId: "tkt_1", commandRequestId: "cmd_1" },
				undefined,
				"team_1",
			);
		});

		it("unlinks a command by passing null through", async () => {
			await timeline.POST(req("POST", { action: "unlink_command" }), idParams);
			expect(mocks.linkTicketCommand).toHaveBeenCalledWith(
				expect.objectContaining({ commandRequestId: null }),
			);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_2",
				"ticket.unlink_command",
				{ ticketId: "tkt_1" },
				undefined,
				"team_1",
			);
		});

		it("links and unlinks a server the same way", async () => {
			await timeline.POST(req("POST", { action: "link_server", serverId: "srv_1" }), idParams);
			expect(mocks.linkTicketServer).toHaveBeenCalledWith(
				expect.objectContaining({ serverId: "srv_1", session: ticketManager }),
			);

			mocks.linkTicketServer.mockClear();
			await timeline.POST(req("POST", { action: "unlink_server" }), idParams);
			expect(mocks.linkTicketServer).toHaveBeenCalledWith(
				expect.objectContaining({ serverId: null }),
			);
		});

		it("returns the refreshed timeline after a link", async () => {
			mocks.getTicketTimeline.mockResolvedValue({ ...timelineView, relatedCommandId: "cmd_1" });
			const res = await timeline.POST(
				req("POST", { action: "link_command", commandRequestId: "cmd_1" }),
				idParams,
			);
			expect(await res.json()).toMatchObject({ relatedCommandId: "cmd_1" });
		});

		it.each([
			["an unknown action", { action: "detonate" }],
			["a link_command with no id", { action: "link_command" }],
			["a link_server with a blank id", { action: "link_server", serverId: "" }],
		])("rejects %s", async (_label, body) => {
			const res = await timeline.POST(req("POST", body), idParams);
			expect(res.status).toBe(400);
			expect(mocks.linkTicketCommand).not.toHaveBeenCalled();
			expect(mocks.linkTicketServer).not.toHaveBeenCalled();
		});
	});

	describe("POST /api/tickets/sla/escalate", () => {
		it("requires ticket:manage behind a write limit", async () => {
			await escalate.POST(req("POST"));
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "ticket:manage",
				rateLimit: { maxRequests: 30, windowMs: 60_000 },
			});
		});

		it("limits a tenant manager to their own team", async () => {
			const res = await escalate.POST(req("POST"));

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ escalated: 3 });
			expect(mocks.escalateBreachedTickets).toHaveBeenCalledWith({ teamId: "team_1" });
		});

		it("sweeps every team for a platform manager", async () => {
			currentSession = platformManager;

			await escalate.POST(req("POST"));

			// undefined (not null) is what tells the service to skip the team filter.
			expect(mocks.escalateBreachedTickets).toHaveBeenCalledWith({ teamId: undefined });
		});

		it("passes null for a teamless caller so only unassigned tickets are swept", async () => {
			currentSession = { ...ticketManager, currentTeamId: null };

			await escalate.POST(req("POST"));

			expect(mocks.escalateBreachedTickets).toHaveBeenCalledWith({ teamId: null });
		});

		it("audits the escalation count", async () => {
			await escalate.POST(req("POST"));
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_2",
				"ticket.sla_escalate",
				{ escalatedCount: 3 },
				undefined,
				"team_1",
			);
		});
	});
});
