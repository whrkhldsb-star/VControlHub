import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Route-level contract for the customer endpoints. Every route is a thin
 * delegate — the business rules live in `@/lib/team/service` and are covered
 * in its own tests — so this pins the guard configuration and the delegation.
 */
const { serviceMock, guardCalls, teamSessionResponseMock } = vi.hoisted(() => ({
	serviceMock: {
		listTeamsForSession: vi.fn(),
		listCustomerMembers: vi.fn(),
		createTeam: vi.fn(),
		updateTeam: vi.fn(),
		deleteTeam: vi.fn(),
		restoreTeam: vi.fn(),
		setCustomerMembership: vi.fn(),
		removeTeamMember: vi.fn(),
		switchCurrentTeam: vi.fn(),
	},
	guardCalls: [] as Record<string, unknown>[],
	teamSessionResponseMock: vi.fn(async (_request: Request, _teamId: string | null, body: unknown) => Response.json(body)),
}));

vi.mock("@/lib/team/service", () => serviceMock);
vi.mock("@/lib/auth/team-session-response", () => ({ teamSessionResponse: teamSessionResponseMock }));
vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: Record<string, any>, handler: (ctx: unknown) => Promise<Response>) => {
		guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) return new Response(JSON.stringify({ error: "输入参数无效" }), { status: 400 });
			body = parsed.data;
		}
		return handler({ session, body });
	}),
}));

const session = { userId: "u_admin", username: "admin", roles: ["admin"], mustChangePassword: false, currentTeamId: null };

const { GET, POST: createRoute } = await import("../route");
const { PATCH, DELETE: deleteRoute } = await import("../[id]/route");
const { POST: restoreRoute } = await import("../[id]/restore/route");
const { GET: listMembersRoute, POST: setMemberRoute } = await import("../[id]/members/route");
const { PATCH: updateMemberRoute, DELETE: removeMemberRoute } = await import("../[id]/members/[userId]/route");
const { POST: switchRoute } = await import("../switch/route");

const json = (method: string, url: string, body: unknown) =>
	new Request(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

describe("customer API routes", () => {
	beforeEach(() => {
		for (const stub of Object.values(serviceMock)) stub.mockReset();
		teamSessionResponseMock.mockClear();
		guardCalls.length = 0;
	});

	it("lists customers to anyone who may read their customer", async () => {
		serviceMock.listTeamsForSession.mockResolvedValueOnce({ teams: [], deletedTeams: [], currentTeamId: null });
		const response = await GET(new Request("https://app.test/api/teams"));
		expect(response.status).toBe(200);
		expect(guardCalls[0]).toMatchObject({ permission: "team:read" });
		expect(serviceMock.listTeamsForSession).toHaveBeenCalledWith(session);
	});

	it("keeps every write behind the platform-only team:manage permission", async () => {
		serviceMock.createTeam.mockResolvedValue({ id: "team_1" });
		serviceMock.updateTeam.mockResolvedValue({ id: "team_1" });
		serviceMock.deleteTeam.mockResolvedValue({ nextCurrentTeamId: null });
		serviceMock.listCustomerMembers.mockResolvedValue([]);
		serviceMock.setCustomerMembership.mockResolvedValue({});
		serviceMock.switchCurrentTeam.mockResolvedValue(null);

		await createRoute(json("POST", "https://app.test/api/teams", { name: "Acme" }));
		await PATCH(json("PATCH", "https://app.test/api/teams/team_1", { name: "Acme 2" }), params({ id: "team_1" }));
		await deleteRoute(new Request("https://app.test/api/teams/team_1", { method: "DELETE" }), params({ id: "team_1" }));
		await restoreRoute(new Request("https://app.test/api/teams/team_1/restore", { method: "POST" }), params({ id: "team_1" }));
		await listMembersRoute(new Request("https://app.test/api/teams/team_1/members"), params({ id: "team_1" }));
		await setMemberRoute(json("POST", "https://app.test/api/teams/team_1/members", { userId: "u_2" }), params({ id: "team_1" }));
		await updateMemberRoute(json("PATCH", "https://app.test/api/teams/team_1/members/u_2", { identityTemplateId: "identity:operator" }), params({ id: "team_1", userId: "u_2" }));
		await removeMemberRoute(new Request("https://app.test/api/teams/team_1/members/u_2", { method: "DELETE" }), params({ id: "team_1", userId: "u_2" }));
		await switchRoute(json("POST", "https://app.test/api/teams/switch", { teamId: null }));

		expect(guardCalls).toHaveLength(9);
		for (const options of guardCalls) expect(options).toMatchObject({ permission: "team:manage" });
	});

	it("passes route ids and bodies through to the service", async () => {
		serviceMock.setCustomerMembership.mockResolvedValue({});
		await setMemberRoute(json("POST", "https://app.test/api/teams/team_1/members", { userId: "u_2", identityTemplateId: "identity:files" }), params({ id: "team_1" }));
		expect(serviceMock.setCustomerMembership).toHaveBeenCalledWith({ teamId: "team_1", userId: "u_2", identityTemplateId: "identity:files" }, session);

		await updateMemberRoute(json("PATCH", "https://app.test/api/teams/team_1/members/u_3", { identityTemplateId: "identity:viewer" }), params({ id: "team_1", userId: "u_3" }));
		expect(serviceMock.setCustomerMembership).toHaveBeenLastCalledWith({ teamId: "team_1", userId: "u_3", identityTemplateId: "identity:viewer" }, session);

		await removeMemberRoute(new Request("https://app.test/api/teams/team_1/members/u_3", { method: "DELETE" }), params({ id: "team_1", userId: "u_3" }));
		expect(serviceMock.removeTeamMember).toHaveBeenCalledWith("team_1", "u_3", session);
	});

	it("rotates the cookie after a switch, including to all customers", async () => {
		serviceMock.switchCurrentTeam.mockResolvedValueOnce({ id: "team_2" });
		await switchRoute(json("POST", "https://app.test/api/teams/switch", { teamId: "team_2" }));
		expect(teamSessionResponseMock).toHaveBeenLastCalledWith(expect.any(Request), "team_2", expect.anything());

		serviceMock.switchCurrentTeam.mockResolvedValueOnce(null);
		await switchRoute(json("POST", "https://app.test/api/teams/switch", { teamId: null }));
		expect(teamSessionResponseMock).toHaveBeenLastCalledWith(expect.any(Request), null, expect.anything());
	});

	it("moves the caller's cookie off a customer it just deleted", async () => {
		serviceMock.deleteTeam.mockResolvedValueOnce({ nextCurrentTeamId: null });
		await deleteRoute(new Request("https://app.test/api/teams/team_1", { method: "DELETE" }), params({ id: "team_1" }));
		expect(teamSessionResponseMock).toHaveBeenCalledWith(expect.any(Request), null, { success: true });
	});

	it("rejects invalid bodies before reaching the service", async () => {
		const blankName = await createRoute(json("POST", "https://app.test/api/teams", { name: "  " }));
		expect(blankName.status).toBe(400);
		const badSlug = await createRoute(json("POST", "https://app.test/api/teams", { name: "Acme", slug: "_hidden" }));
		expect(badSlug.status).toBe(400);
		const noAccount = await setMemberRoute(json("POST", "https://app.test/api/teams/team_1/members", {}), params({ id: "team_1" }));
		expect(noAccount.status).toBe(400);
		expect(serviceMock.createTeam).not.toHaveBeenCalled();
		expect(serviceMock.setCustomerMembership).not.toHaveBeenCalled();
	});
});
