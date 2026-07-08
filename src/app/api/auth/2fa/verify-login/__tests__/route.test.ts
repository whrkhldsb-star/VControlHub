import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, verifyPending2faTokenMock, createSessionTokenMock, getConfiguredSessionTtlSecondsMock, generateCsrfTokenMock, verifyTotpMock, prismaMock, auditUserActionMock, auditSystemActionMock, checkRateLimitMock, getClientIpMock } = vi.hoisted(() => ({
	cookiesMock: vi.fn(),
	verifyPending2faTokenMock: vi.fn(),
	createSessionTokenMock: vi.fn(),
	getConfiguredSessionTtlSecondsMock: vi.fn(),
	generateCsrfTokenMock: vi.fn(),
	verifyTotpMock: vi.fn(),
	prismaMock: { user: { findUnique: vi.fn() } },
	auditUserActionMock: vi.fn(),
	auditSystemActionMock: vi.fn(),
	checkRateLimitMock: vi.fn(),
	getClientIpMock: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: cookiesMock }));
vi.mock("@/lib/auth/session", () => ({
	verifyPending2faToken: verifyPending2faTokenMock,
	createSessionToken: createSessionTokenMock,
	getConfiguredSessionTtlSeconds: getConfiguredSessionTtlSecondsMock,
	getSessionCookieName: () => "vcontrolhub_session",
	getPending2faCookieName: () => "vcontrolhub_pending_2fa",
}));
vi.mock("@/lib/auth/csrf", () => ({
	generateCsrfToken: generateCsrfTokenMock,
	getCsrfCookieName: () => "vcontrolhub_csrf",
}));
vi.mock("otplib", () => ({ verify: verifyTotpMock }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/audit/service", () => ({
	auditUserAction: auditUserActionMock,
	auditSystemAction: auditSystemActionMock,
}));
vi.mock("@/lib/rate-limit", () => ({
	LOGIN_RATE_LIMIT: { windowMs: 1, max: 5 },
	checkRateLimit: checkRateLimitMock,
	checkRateLimitAsync: checkRateLimitMock,
	getClientIp: getClientIpMock,
}));
vi.mock("@/lib/logging", () => ({ createLogger: () => ({ error: vi.fn() }) }));

import { POST } from "../route";

const sessionPayload = {
	userId: "u_1",
	username: "admin",
	roles: ["admin"],
	mustChangePassword: false,
	currentTeamId: null,
};

describe("POST /api/auth/2fa/verify-login", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		cookiesMock.mockResolvedValue({ get: vi.fn(() => ({ value: "pending-token" })), delete: vi.fn() });
		checkRateLimitMock.mockReturnValue({ allowed: true });
		getClientIpMock.mockReturnValue("127.0.0.1");
		verifyPending2faTokenMock.mockResolvedValue(sessionPayload);
		prismaMock.user.findUnique.mockResolvedValue({ twoFactorEnabled: true, twoFactorSecret: "secret" });
		verifyTotpMock.mockReturnValue(true);
		createSessionTokenMock.mockResolvedValue("session-token");
		getConfiguredSessionTtlSecondsMock.mockResolvedValue(7 * 24 * 60 * 60);
		generateCsrfTokenMock.mockReturnValue("csrf-token");
	});

	it("sets session, csrf and pending-clear cookies as separate Set-Cookie headers", async () => {
		const response = await POST(new Request("https://app.example.test/api/auth/2fa/verify-login", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
			body: JSON.stringify({ code: "123456" }),
		}));

		expect(response.status).toBe(200);
		expect(createSessionTokenMock).toHaveBeenCalledWith(sessionPayload, { remember: false });
		expect(getConfiguredSessionTtlSecondsMock).toHaveBeenCalledWith(false);
		const setCookies = response.headers.getSetCookie();
		expect(setCookies).toHaveLength(3);
		expect(setCookies[0]).toContain("vcontrolhub_session=session-token");
		expect(setCookies[0]).toContain("HttpOnly");
		expect(setCookies[0]).toContain("Secure");
		expect(setCookies[0]).toContain("Max-Age=604800");
		expect(setCookies[1]).toContain("vcontrolhub_csrf=csrf-token");
		expect(setCookies[1]).toContain("Secure");
		expect(setCookies[1]).toContain("Max-Age=604800");
		expect(setCookies[2]).toContain("vcontrolhub_pending_2fa=");
		expect(setCookies[2]).toContain("Max-Age=0");
	});

	it("preserves remember-me across 2FA and sets 30-day cookies", async () => {
		verifyPending2faTokenMock.mockResolvedValueOnce({ ...sessionPayload, remember: true });
		getConfiguredSessionTtlSecondsMock.mockResolvedValueOnce(30 * 24 * 60 * 60);

		const response = await POST(new Request("https://app.example.test/api/auth/2fa/verify-login", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
			body: JSON.stringify({ code: "123456" }),
		}));

		expect(response.status).toBe(200);
		expect(createSessionTokenMock).toHaveBeenCalledWith(sessionPayload, { remember: true });
		expect(getConfiguredSessionTtlSecondsMock).toHaveBeenCalledWith(true);
		const cookies = response.headers.getSetCookie().join("\n");
		expect(cookies).toContain("vcontrolhub_session=session-token");
		expect(cookies).toContain("vcontrolhub_csrf=csrf-token");
		expect(cookies).toContain("Max-Age=2592000");
	});
});
