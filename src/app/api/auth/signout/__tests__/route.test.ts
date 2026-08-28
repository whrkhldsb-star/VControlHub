/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signout must clear every cookie login can set. A leftover `csrf_token` on a
 * shared browser is a readable token belonging to the previous user, and a
 * leftover pending-2FA cookie still exchanges for a full session.
 */

const mocks = vi.hoisted(() => ({
	getApiSession: vi.fn(),
	auditUserAction: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
	getApiSession: mocks.getApiSession,
}));

vi.mock("@/lib/audit/service", () => ({
	auditUserAction: mocks.auditUserAction,
}));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: async (
		_request: Request,
		_opts: unknown,
		handler: () => Promise<Response>,
	) => handler(),
}));

vi.mock("@/lib/http/rate-limit-presets", () => ({
	GENERAL_WRITE_LIMIT: { key: "general-write" },
}));

vi.mock("@/lib/auth/session", () => ({
	getSessionCookieName: () => "vch_session",
	getPending2faCookieName: () => "vch_pending_2fa",
}));

vi.mock("@/lib/auth/csrf", () => ({
	getCsrfCookieName: () => "csrf_token",
}));

const route = await import("../route");

function clearedCookies(response: Response): Map<string, string> {
	const entries = new Map<string, string>();
	for (const header of response.headers.getSetCookie()) {
		const name = header.split("=")[0]!;
		entries.set(name, header);
	}
	return entries;
}

describe("POST /api/auth/signout", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getApiSession.mockResolvedValue({
			userId: "u1",
			username: "alice",
			currentTeamId: "team_a",
		});
	});

	it("clears the session, CSRF and pending-2FA cookies", async () => {
		const response = await route.POST(
			new Request("https://hub.example/api/auth/signout", { method: "POST" }),
		);

		const cookies = clearedCookies(response);
		expect([...cookies.keys()].sort()).toEqual([
			"csrf_token",
			"vch_pending_2fa",
			"vch_session",
		]);
		for (const header of cookies.values()) {
			// Max-Age=0 is what actually removes it; a bare empty value would leave
			// the cookie in place until its original expiry.
			expect(header).toContain("Max-Age=0");
			expect(header).toContain("Path=/");
		}
		// csrf_token is set readable at login, so the clear must match or the
		// browser keeps the original alongside a second HttpOnly one.
		expect(cookies.get("csrf_token")).not.toContain("HttpOnly");
		expect(cookies.get("vch_session")).toContain("HttpOnly");
		expect(cookies.get("vch_pending_2fa")).toContain("HttpOnly");
	});

	it("marks cookies Secure over HTTPS and redirects to /login", async () => {
		const response = await route.POST(
			new Request("https://hub.example/api/auth/signout", { method: "POST" }),
		);

		expect(response.status).toBe(303);
		expect(response.headers.get("location")).toBe("/login");
		for (const header of clearedCookies(response).values()) {
			expect(header).toContain("Secure");
		}
	});

	it("audits the signout before clearing, while the session is still resolvable", async () => {
		await route.POST(new Request("https://hub.example/api/auth/signout", { method: "POST" }));

		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u1",
			"auth.signout",
			expect.objectContaining({ username: "alice" }),
			undefined,
			"team_a",
		);
	});

	it("still clears cookies when there is no resolvable session", async () => {
		mocks.getApiSession.mockResolvedValue(null);

		const response = await route.POST(
			new Request("https://hub.example/api/auth/signout", { method: "POST" }),
		);

		expect(mocks.auditUserAction).not.toHaveBeenCalled();
		expect(clearedCookies(response).size).toBe(3);
	});
});
