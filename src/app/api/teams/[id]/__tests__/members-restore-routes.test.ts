import { beforeEach, describe, expect, it, vi } from "vitest";

import { ForbiddenError, NotFoundError } from "@/lib/errors";
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
	UPLOAD_CHUNK_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ restoreTeam: vi.fn(), listCustomerMembers: vi.fn(), setCustomerMembership: vi.fn(), removeTeamMember: vi.fn() }));
vi.mock("@/lib/team/service", () => ({ restoreTeam: mocks.restoreTeam, listCustomerMembers: mocks.listCustomerMembers, setCustomerMembership: mocks.setCustomerMembership, removeTeamMember: mocks.removeTeamMember }));

const restore = await import("../restore/route");
const members = await import("../members/route");
const member = await import("../members/[userId]/route");
const json = (method: string, body?: unknown) => new Request("http://local/x", { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const teamParams = Promise.resolve({ id: "team_1" });
const memberParams = Promise.resolve({ id: "team_1", userId: "u_2" });

describe("customer restore and membership routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession();
		mocks.listCustomerMembers.mockResolvedValue([{ userId: "u_2", identityTemplateId: "tpl_1" }]);
		mocks.setCustomerMembership.mockResolvedValue({ userId: "u_2", identityTemplateId: "tpl_2" });
	});

	it("all of them need team:manage", async () => {
		routeSession.current = customerSession(["team:read"]);
		expect((await restore.POST(json("POST"), { params: teamParams })).status).toBe(403);
		expect((await members.GET(json("GET"), { params: teamParams })).status).toBe(403);
		expect((await members.POST(json("POST", { userId: "u_2", identityTemplateId: "tpl_1" }), { params: teamParams })).status).toBe(403);
		expect((await member.PATCH(json("PATCH", { identityTemplateId: "tpl_2" }), { params: memberParams })).status).toBe(403);
		expect((await member.DELETE(json("DELETE"), { params: memberParams })).status).toBe(403);
		expect(mocks.setCustomerMembership).not.toHaveBeenCalled();
	});

	it("restores a soft-deleted customer through the service, which decides visibility", async () => {
		const res = await restore.POST(json("POST"), { params: teamParams });
		expect(res.status).toBe(200);
		expect(mocks.restoreTeam).toHaveBeenCalledWith("team_1", expect.objectContaining({ userId: "u_admin" }));
		mocks.restoreTeam.mockRejectedValueOnce(new NotFoundError("gone"));
		expect((await restore.POST(json("POST"), { params: teamParams })).status).toBe(404);
	});

	it("lists, adds, retemplates and removes members with the caller's session", async () => {
		expect(await (await members.GET(json("GET"), { params: teamParams })).json()).toEqual({ members: [{ userId: "u_2", identityTemplateId: "tpl_1" }] });
		const added = await members.POST(json("POST", { userId: "u_2", identityTemplateId: "tpl_1" }), { params: teamParams });
		expect(added.status).toBe(200);
		expect(mocks.setCustomerMembership).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team_1", userId: "u_2", identityTemplateId: "tpl_1" }), expect.objectContaining({ userId: "u_admin" }));
		expect((await members.POST(json("POST", { userId: "" }), { params: teamParams })).status).toBe(400);
		const patched = await member.PATCH(json("PATCH", { identityTemplateId: "tpl_2" }), { params: memberParams });
		expect(patched.status).toBe(200);
		expect(mocks.setCustomerMembership).toHaveBeenLastCalledWith({ teamId: "team_1", userId: "u_2", identityTemplateId: "tpl_2" }, expect.anything());
		expect((await member.DELETE(json("DELETE"), { params: memberParams })).status).toBe(200);
		expect(mocks.removeTeamMember).toHaveBeenCalledWith("team_1", "u_2", expect.anything());
		mocks.removeTeamMember.mockRejectedValueOnce(new ForbiddenError("last admin"));
		expect((await member.DELETE(json("DELETE"), { params: memberParams })).status).toBe(403);
	});
});
