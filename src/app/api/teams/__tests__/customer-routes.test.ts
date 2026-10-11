import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "@/lib/errors";
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
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({
	listCustomerMembers: vi.fn(),
	setCustomerMembership: vi.fn(),
	removeTeamMember: vi.fn(),
	restoreTeam: vi.fn(),
	transferServerToCustomer: vi.fn(),
}));
vi.mock("@/lib/team/service", () => ({
	listCustomerMembers: mocks.listCustomerMembers,
	setCustomerMembership: mocks.setCustomerMembership,
	removeTeamMember: mocks.removeTeamMember,
	restoreTeam: mocks.restoreTeam,
}));
vi.mock("@/lib/server/transfer", () => ({ transferServerToCustomer: mocks.transferServerToCustomer }));

const members = await import("../[id]/members/route");
const member = await import("../[id]/members/[userId]/route");
const restore = await import("../[id]/restore/route");
const transfer = await import("../../servers/[id]/transfer/route");
const req = (method: string, url: string, body?: unknown) =>
	new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const teamParams = Promise.resolve({ id: "team_2" });
const memberParams = Promise.resolve({ id: "team_2", userId: "u_9" });
const serverParams = Promise.resolve({ id: "srv_1" });

describe("customer management routes (team:manage)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession({ permissions: ["team:manage"] });
		mocks.listCustomerMembers.mockResolvedValue([{ userId: "u_9" }]);
		mocks.setCustomerMembership.mockResolvedValue({ userId: "u_9", identityTemplateId: "identity:viewer" });
		mocks.transferServerToCustomer.mockResolvedValue({ movedStorageNodes: 1 });
	});

	it("are closed to customer accounts, even a customer admin", async () => {
		routeSession.current = customerSession(["user:manage", "server:write"]);
		expect((await members.GET(req("GET", "http://local/api/teams/team_2/members"), { params: teamParams })).status).toBe(403);
		expect((await members.POST(req("POST", "http://local/api/teams/team_2/members", { userId: "u_9" }), { params: teamParams })).status).toBe(403);
		expect((await member.PATCH(req("PATCH", "http://local/api/teams/team_2/members/u_9", { identityTemplateId: "identity:viewer" }), { params: memberParams })).status).toBe(403);
		expect((await member.DELETE(req("DELETE", "http://local/api/teams/team_2/members/u_9"), { params: memberParams })).status).toBe(403);
		expect((await restore.POST(req("POST", "http://local/api/teams/team_2/restore"), { params: teamParams })).status).toBe(403);
		expect((await transfer.POST(req("POST", "http://local/api/servers/srv_1/transfer", { teamId: "team_2" }), { params: serverParams })).status).toBe(403);
		expect(mocks.setCustomerMembership).not.toHaveBeenCalled();
		expect(mocks.transferServerToCustomer).not.toHaveBeenCalled();
	});

	it("lists and assigns members through the service with the caller's session", async () => {
		expect(await (await members.GET(req("GET", "http://local/api/teams/team_2/members"), { params: teamParams })).json()).toEqual({ members: [{ userId: "u_9" }] });
		expect(mocks.listCustomerMembers).toHaveBeenCalledWith("team_2", expect.objectContaining({ userId: "u_admin" }));

		const added = await members.POST(req("POST", "http://local/api/teams/team_2/members", { userId: "u_9", identityTemplateId: "identity:viewer" }), { params: teamParams });
		expect(added.status).toBe(200);
		expect(mocks.setCustomerMembership).toHaveBeenCalledWith({ teamId: "team_2", userId: "u_9", identityTemplateId: "identity:viewer" }, expect.objectContaining({ userId: "u_admin" }));

		const changed = await member.PATCH(req("PATCH", "http://local/api/teams/team_2/members/u_9", { identityTemplateId: "identity:operator" }), { params: memberParams });
		expect(changed.status).toBe(200);
		expect(mocks.setCustomerMembership).toHaveBeenLastCalledWith({ teamId: "team_2", userId: "u_9", identityTemplateId: "identity:operator" }, expect.anything());

		const removed = await member.DELETE(req("DELETE", "http://local/api/teams/team_2/members/u_9"), { params: memberParams });
		expect(removed.status).toBe(200);
		expect(mocks.removeTeamMember).toHaveBeenCalledWith("team_2", "u_9", expect.anything());
	});

	it("rejects malformed membership bodies before the service", async () => {
		expect((await members.POST(req("POST", "http://local/api/teams/team_2/members", { userId: "" }), { params: teamParams })).status).toBe(400);
		expect((await member.PATCH(req("PATCH", "http://local/api/teams/team_2/members/u_9", {}), { params: memberParams })).status).toBe(400);
		expect(mocks.setCustomerMembership).not.toHaveBeenCalled();
	});

	it("restores a deleted customer and moves a server, keeping the service's statuses", async () => {
		expect((await restore.POST(req("POST", "http://local/api/teams/team_2/restore"), { params: teamParams })).status).toBe(200);
		expect(mocks.restoreTeam).toHaveBeenCalledWith("team_2", expect.objectContaining({ userId: "u_admin" }));

		const moved = await transfer.POST(req("POST", "http://local/api/servers/srv_1/transfer", { teamId: "team_2" }), { params: serverParams });
		expect(moved.status).toBe(200);
		expect(await moved.json()).toMatchObject({ success: true, movedStorageNodes: 1 });
		expect(mocks.transferServerToCustomer).toHaveBeenCalledWith("srv_1", "team_2", expect.objectContaining({ userId: "u_admin" }));

		mocks.transferServerToCustomer.mockRejectedValueOnce(new ConflictError("busy"));
		expect((await transfer.POST(req("POST", "http://local/api/servers/srv_1/transfer", { teamId: "team_2" }), { params: serverParams })).status).toBe(409);
		mocks.restoreTeam.mockRejectedValueOnce(new NotFoundError("gone"));
		expect((await restore.POST(req("POST", "http://local/api/teams/team_2/restore"), { params: teamParams })).status).toBe(404);
	});
});
