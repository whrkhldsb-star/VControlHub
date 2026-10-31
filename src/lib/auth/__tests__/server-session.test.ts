import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const cookieGetMock = vi.fn();

vi.mock("next/headers", () => ({
	cookies: vi.fn(async () => ({ get: cookieGetMock })),
}));

vi.mock("@/lib/auth/session", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/auth/session")>();
	return {
		...actual,
		getSessionCookieName: () => "vcontrolhub_session",
		verifySessionToken: vi.fn(async (token: string) => {
			if (token === "valid-admin") {
				return { userId: "u1", username: "admin", roles: ["admin"], mustChangePassword: false };
			}
			if (token === "valid-viewer") {
				return { userId: "u2", username: "viewer", roles: ["viewer"], mustChangePassword: false };
			}
			if (token === "db-offline") throw new Error("database offline");
			const { AuthError } = await import("@/lib/errors");
			throw new AuthError("invalid token");
		}),
	};
});

describe("getCurrentSession", () => {
	it("propagates database failures instead of pretending the cookie is invalid", async () => {
		cookieGetMock.mockReturnValue({ value: "db-offline" });
		const { getCurrentSession } = await import("../server-session");
		await expect(getCurrentSession()).rejects.toThrow("database offline");
	});
	beforeEach(() => {
		cookieGetMock.mockReset();
		// Bypass auth gate so verifySessionToken mock runs (dev default falls back
		// to a dev secret when AUTH_SESSION_SECRET is unset).
		vi.stubEnv("AUTH_SESSION_SECRET", "test-session-secret");
		vi.stubEnv("APP_SLUG", "vcontrolhub");
	});

	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("returns null when no session cookie is present", async () => {
		cookieGetMock.mockReturnValue(undefined);
		const { getCurrentSession } = await import("../server-session");
		expect(await getCurrentSession()).toBeNull();
	});

	it("returns the verified session payload when the cookie is valid", async () => {
		cookieGetMock.mockReturnValue({ value: "valid-admin" });
		const { getCurrentSession } = await import("../server-session");
		const session = await getCurrentSession();
		expect(session).toEqual({
			userId: "u1",
			username: "admin",
			roles: ["admin"],
			mustChangePassword: false,
		});
	});

	it("returns null when verifySessionToken throws (invalid / expired)", async () => {
		cookieGetMock.mockReturnValue({ value: "garbage" });
		const { getCurrentSession } = await import("../server-session");
		expect(await getCurrentSession()).toBeNull();
	});
});
