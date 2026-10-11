import { beforeEach, describe, expect, it, vi } from "vitest";

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
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({
	listIdentityTemplates: vi.fn(),
	createIdentityTemplate: vi.fn(),
	updateIdentityTemplate: vi.fn(),
	deleteIdentityTemplate: vi.fn(),
	auditUserAction: vi.fn(),
}));
vi.mock("@/lib/auth/identity-template-service", async (original) => {
	const actual = await original<typeof import("@/lib/auth/identity-template-service")>();
	return {
		identityTemplateInputSchema: actual.identityTemplateInputSchema,
		listIdentityTemplates: mocks.listIdentityTemplates,
		createIdentityTemplate: mocks.createIdentityTemplate,
		updateIdentityTemplate: mocks.updateIdentityTemplate,
		deleteIdentityTemplate: mocks.deleteIdentityTemplate,
	};
});
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const collection = await import("../route");
const item = await import("../[id]/route");
const json = (method: string, url: string, body?: unknown) =>
	new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = Promise.resolve({ id: "tpl_1" });

describe("identity template routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession({ permissions: ["team:manage"] });
		mocks.listIdentityTemplates.mockResolvedValue([{ id: "identity:viewer" }]);
		mocks.createIdentityTemplate.mockResolvedValue({ id: "tpl_1", name: "Ops" });
		mocks.updateIdentityTemplate.mockResolvedValue({ id: "tpl_1", name: "Ops 2" });
		mocks.deleteIdentityTemplate.mockResolvedValue(undefined);
	});

	it("belongs to platform administrators only: a customer admin is refused on every verb", async () => {
		routeSession.current = customerSession(["user:read", "server:read"]);
		expect((await collection.GET(json("GET", "http://local/api/identity-templates"))).status).toBe(403);
		expect((await collection.POST(json("POST", "http://local/api/identity-templates", { name: "x", permissions: ["server:read"] }))).status).toBe(403);
		expect((await item.PATCH(json("PATCH", "http://local/api/identity-templates/tpl_1", { name: "x", permissions: ["server:read"] }), { params })).status).toBe(403);
		expect((await item.DELETE(json("DELETE", "http://local/api/identity-templates/tpl_1"), { params })).status).toBe(403);
		expect(mocks.createIdentityTemplate).not.toHaveBeenCalled();
		expect(mocks.deleteIdentityTemplate).not.toHaveBeenCalled();
	});

	it("lists, creates, updates and deletes with an audit trail", async () => {
		expect(await (await collection.GET(json("GET", "http://local/api/identity-templates"))).json()).toEqual({ templates: [{ id: "identity:viewer" }] });

		const created = await collection.POST(json("POST", "http://local/api/identity-templates", { name: "Ops", permissions: ["server:read", "server:ssh"] }));
		expect(created.status).toBe(201);
		expect(mocks.createIdentityTemplate).toHaveBeenCalledWith(expect.objectContaining({ name: "Ops", permissions: ["server:read", "server:ssh"] }), "u_admin");
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_admin", "identity_template.create", { templateId: "tpl_1", name: "Ops" });

		const updated = await item.PATCH(json("PATCH", "http://local/api/identity-templates/tpl_1", { name: "Ops 2", permissions: ["server:read"] }), { params });
		expect(updated.status).toBe(200);
		expect(mocks.updateIdentityTemplate).toHaveBeenCalledWith("tpl_1", expect.objectContaining({ name: "Ops 2" }));

		const deleted = await item.DELETE(json("DELETE", "http://local/api/identity-templates/tpl_1"), { params });
		expect(deleted.status).toBe(200);
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_admin", "identity_template.delete", { templateId: "tpl_1" }, "WARNING");
	});

	it("validates the template body before touching the service", async () => {
		const res = await collection.POST(json("POST", "http://local/api/identity-templates", { name: "", permissions: "server:read" }));
		expect(res.status).toBe(400);
		expect(mocks.createIdentityTemplate).not.toHaveBeenCalled();
	});
});
