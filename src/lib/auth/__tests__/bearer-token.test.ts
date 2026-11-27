import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	verifyApiToken: vi.fn(),
	loadApiTokenOwnerSession: vi.fn(),
}));

vi.mock("@/lib/api-token/service", () => ({ verifyApiToken: mocks.verifyApiToken }));
vi.mock("@/lib/api-token/authorization", async (original) => ({
	...((await original()) as Record<string, unknown>),
	loadApiTokenOwnerSession: mocks.loadApiTokenOwnerSession,
}));

const { authenticateBearerForPermissions, verifiedBearerTokenId } = await import("../bearer-token");

const owner = { userId: "u_owner", username: "owner", roles: ["admin"], mustChangePassword: false, currentTeamId: null };
const request = (method: string, path = "/api/tickets/t1") =>
	new Request(`https://hub.example${path}`, { method, headers: { authorization: "Bearer whr_token" } });

describe("authenticateBearerForPermissions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadApiTokenOwnerSession.mockResolvedValue(owner);
	});

	it("grants a read permission to a read-scoped token on a GET", async () => {
		mocks.verifyApiToken.mockResolvedValue({ userId: "u_owner", scopes: ["read"], tokenId: "tok_1", teamId: null });
		const result = await authenticateBearerForPermissions(request("GET"), ["ticket:read"]);
		expect(result).not.toBeInstanceOf(Response);
		expect((result as { session: { permissions: string[] } }).session.permissions).toEqual(["ticket:read"]);
	});

	it("never lets a read permission authorise a state-changing request made with a token", async () => {
		// A default read-only token must not post comments or cancel jobs through handlers that accept a read permission.
		for (const scopes of [["read"], ["ticket:read"]]) {
			mocks.verifyApiToken.mockResolvedValue({ userId: "u_owner", scopes, tokenId: "tok_1", teamId: null });
			for (const method of ["POST", "PATCH", "DELETE"]) {
				const result = await authenticateBearerForPermissions(request(method), ["ticket:create", "ticket:manage", "ticket:read"]);
				expect(result).toBeInstanceOf(Response);
				expect((result as Response).status).toBe(403);
			}
		}
	});

	it("still grants a write scope on a write request", async () => {
		mocks.verifyApiToken.mockResolvedValue({ userId: "u_owner", scopes: ["image:write"], tokenId: "tok_1", teamId: null });
		const result = await authenticateBearerForPermissions(request("POST", "/api/images/upload"), ["image:write"]);
		if (!result || result instanceof Response) throw new Error("Expected a token session");
		expect(result.session.permissions).toEqual(["image:write"]);
		expect(verifiedBearerTokenId(result.session)).toBe("tok_1");
	});

	it("refuses a token on a route the bearer policy closes to tokens for that method, before any lookup", async () => {
		// The proxy only checks that a session cookie looks plausible and that the CSRF pair matches; a script can
		// fake both and reach a write route with a write-scoped token, so the route must refuse it as well.
		mocks.verifyApiToken.mockResolvedValue({ userId: "u_owner", scopes: ["storage:write", "image:write"], tokenId: "tok_1", teamId: null });
		for (const [method, path] of [["POST", "/api/servers"], ["DELETE", "/api/images/i1"], ["PATCH", "/api/images/upload"]] as const) {
			const result = await authenticateBearerForPermissions(request(method, path), ["storage:write", "image:write"]);
			expect(result).toBeInstanceOf(Response);
			expect((result as Response).status).toBe(403);
		}
		expect(mocks.verifyApiToken).not.toHaveBeenCalled();
		// Reads stay open on every API route.
		mocks.verifyApiToken.mockResolvedValue({ userId: "u_owner", scopes: ["image:read"], tokenId: "tok_1", teamId: null });
		expect(await authenticateBearerForPermissions(request("GET", "/api/images/list"), ["image:read"])).not.toBeInstanceOf(Response);
	});
});
