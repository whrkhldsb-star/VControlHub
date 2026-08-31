import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level contract for the workspace endpoints. Every one of them is a thin
 * delegate — all authorization lives in `@/lib/team/service` — so what is worth
 * pinning here is the guard configuration and the delegation, not the business
 * rules (those are covered in `src/lib/team/__tests__/service.test.ts`).
 */
const { serviceMock, guardCalls } = vi.hoisted(() => ({
	serviceMock: {
		listTeamsForSession: vi.fn(),
		createTeam: vi.fn(),
		updateTeam: vi.fn(),
		deleteTeam: vi.fn(),
		addTeamMember: vi.fn(),
		removeTeamMember: vi.fn(),
		switchCurrentTeam: vi.fn(),
	},
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/team/service", () => serviceMock);
vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) {
				return new Response(JSON.stringify({ error: "输入参数无效" }), { status: 400 });
			}
			body = parsed.data;
		}
		try {
			return await handler({ session, body });
		} catch (error) {
			const status = (error as { status?: number }).status ?? 500;
			return new Response(JSON.stringify({ error: (error as Error).message }), { status });
		}
	}),
}));

const session = { userId: "u_admin", username: "admin", roles: ["admin"], mustChangePassword: false, currentTeamId: null };

const { GET, POST: createRoute } = await import("../route");
const { PATCH, DELETE: deleteTeamRoute } = await import("../[id]/route");
const { POST: addMemberRoute } = await import("../[id]/members/route");
const { DELETE: removeMemberRoute } = await import("../[id]/members/[userId]/route");
const { POST: switchRoute } = await import("../switch/route");

function post(url: string, body: unknown) {
	return new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

describe("teams API routes", () => {
	beforeEach(() => {
		// `mockReset` rather than `clearAllMocks`: the latter keeps queued
		// `mockResolvedValueOnce` values, so an unconsumed one leaks into the next
		// test. Resetting the guard mock would wipe its implementation, so only the
		// service stubs are reset.
		for (const stub of Object.values(serviceMock)) stub.mockReset();
		guardCalls.length = 0;
	});

	it("lists workspaces behind team:read", async () => {
		serviceMock.listTeamsForSession.mockResolvedValueOnce({ teams: [], currentTeamId: null });

		const response = await GET(new Request("https://app.example.test/api/teams"));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toEqual({ teams: [], currentTeamId: null });
		expect(guardCalls[0]).toMatchObject({ permission: "team:read" });
		expect(serviceMock.listTeamsForSession).toHaveBeenCalledWith(session);
	});

	it("creates a workspace behind team:create and rate limiting", async () => {
		serviceMock.createTeam.mockResolvedValueOnce({ id: "team_1", slug: "ops" });

		const response = await createRoute(post("https://app.example.test/api/teams", { name: "Ops", slug: "ops" }));

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({ success: true, team: { id: "team_1" } });
		expect(guardCalls[0]).toMatchObject({ permission: "team:create" });
		expect(guardCalls[0]?.rateLimit).toBeDefined();
	});

	it("rejects a slug that could collide with the tombstone prefix at the boundary", async () => {
		// The service refuses `__deleted__*` too; the schema regex means such a body
		// never reaches it. Both layers are deliberate.
		const response = await createRoute(
			post("https://app.example.test/api/teams", { name: "Ghost", slug: "__deleted__ghost" }),
		);

		expect(response.status).toBe(400);
		expect(serviceMock.createTeam).not.toHaveBeenCalled();
	});

	it("rejects a nameless workspace", async () => {
		const response = await createRoute(post("https://app.example.test/api/teams", { name: "   " }));

		expect(response.status).toBe(400);
		expect(serviceMock.createTeam).not.toHaveBeenCalled();
	});

	it.each([
		["PATCH", async () => PATCH(post("https://app.example.test/api/teams/team_1", { name: "Ops" }), { params: Promise.resolve({ id: "team_1" }) })],
		["DELETE", async () => deleteTeamRoute(new Request("https://app.example.test/api/teams/team_1", { method: "DELETE" }), { params: Promise.resolve({ id: "team_1" }) })],
	])("gates %s on the session alone so a workspace owner keeps access", async (_method, call) => {
		serviceMock.updateTeam.mockResolvedValueOnce({ id: "team_1" });
		serviceMock.deleteTeam.mockResolvedValueOnce({ deleted: true });

		await call();

		// A `team:manage` requirement here would lock out the owner of the workspace:
		// updateTeam/deleteTeam accept global team:manage *or* owner/admin of this team.
		expect(guardCalls[0]).toMatchObject({ requireAuth: true });
		expect(guardCalls[0]?.permission).toBeUndefined();
	});

	it("passes the route id through to updateTeam", async () => {
		serviceMock.updateTeam.mockResolvedValueOnce({ id: "team_1", name: "Ops" });

		const response = await PATCH(post("https://app.example.test/api/teams/team_1", { name: "Ops" }), {
			params: Promise.resolve({ id: "team_1" }),
		});

		expect(response.status).toBe(200);
		expect(serviceMock.updateTeam).toHaveBeenCalledWith("team_1", { name: "Ops" }, session);
	});

	it("surfaces the service's own status instead of a blanket 500", async () => {
		serviceMock.deleteTeam.mockRejectedValueOnce(Object.assign(new Error("缺少团队工作区管理权限"), { status: 403 }));

		const response = await deleteTeamRoute(new Request("https://app.example.test/api/teams/team_1", { method: "DELETE" }), {
			params: Promise.resolve({ id: "team_1" }),
		});

		expect(response.status).toBe(403);
	});

	it("adds a member behind team:member:manage and defaults the role", async () => {
		serviceMock.addTeamMember.mockResolvedValueOnce({ role: "member" });

		const response = await addMemberRoute(post("https://app.example.test/api/teams/team_1/members", { username: "alice" }), {
			params: Promise.resolve({ id: "team_1" }),
		});

		expect(response.status).toBe(200);
		expect(guardCalls[0]).toMatchObject({ permission: "team:member:manage" });
		expect(serviceMock.addTeamMember).toHaveBeenCalledWith("team_1", { username: "alice", role: "member" }, session);
	});

	it("refuses to grant the owner role through the member API", async () => {
		const response = await addMemberRoute(
			post("https://app.example.test/api/teams/team_1/members", { username: "alice", role: "owner" }),
			{ params: Promise.resolve({ id: "team_1" }) },
		);

		expect(response.status).toBe(400);
		expect(serviceMock.addTeamMember).not.toHaveBeenCalled();
	});

	it("removes a member behind team:member:manage with both path params", async () => {
		serviceMock.removeTeamMember.mockResolvedValueOnce({ removed: true });

		const response = await removeMemberRoute(
			new Request("https://app.example.test/api/teams/team_1/members/u_member", { method: "DELETE" }),
			{ params: Promise.resolve({ id: "team_1", userId: "u_member" }) },
		);

		expect(response.status).toBe(200);
		expect(guardCalls[0]).toMatchObject({ permission: "team:member:manage" });
		expect(serviceMock.removeTeamMember).toHaveBeenCalledWith("team_1", "u_member", session);
	});

	it("switches workspace on the session alone — membership is the real check", async () => {
		serviceMock.switchCurrentTeam.mockResolvedValueOnce({ id: "team_2", slug: "dev", name: "Dev" });

		const response = await switchRoute(post("https://app.example.test/api/teams/switch", { teamId: "team_2" }));

		expect(response.status).toBe(200);
		expect(guardCalls[0]).toMatchObject({ requireAuth: true });
		expect(serviceMock.switchCurrentTeam).toHaveBeenCalledWith("team_2", session);
	});

	it("rejects a switch with no target workspace", async () => {
		const response = await switchRoute(post("https://app.example.test/api/teams/switch", { teamId: "" }));

		expect(response.status).toBe(400);
		expect(serviceMock.switchCurrentTeam).not.toHaveBeenCalled();
	});
});
