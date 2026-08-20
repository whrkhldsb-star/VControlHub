import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookiesMock, verifyPending2faTokenMock, createSessionTokenMock, getConfiguredSessionTtlSecondsMock, generateCsrfTokenMock, verifyTotpMock, prismaMock, auditUserActionMock, auditSystemActionMock, checkRateLimitMock, getClientIpMock } = vi.hoisted(() => ({
	cookiesMock: vi.fn(),
	verifyPending2faTokenMock: vi.fn(),
	createSessionTokenMock: vi.fn(),
	getConfiguredSessionTtlSecondsMock: vi.fn(),
	generateCsrfTokenMock: vi.fn(),
	verifyTotpMock: vi.fn(),
	prismaMock: { user: { findUnique: vi.fn(), updateMany: vi.fn() } },
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
vi.mock("@/lib/auth/two-factor-secret", () => ({
	// Production opens AES-GCM; tests treat "sealed:" prefix as ciphertext.
	openTwoFactorSecret: (stored: string) =>
		typeof stored === "string" && stored.startsWith("sealed:")
			? stored.slice("sealed:".length)
			: stored,
	sealTwoFactorSecret: (secret: string) => `sealed:${secret}`,
}));
vi.mock("@/lib/auth/two-factor-recovery", () => ({
	normalizeTwoFactorRecoveryCode: (code: string) => (/^[A-Z2-9-]+$/i.test(code) ? code.replaceAll("-", "").toUpperCase() : null),
	findMatchingTwoFactorRecoveryCode: (code: string, stored: unknown) =>
		Array.isArray(stored) && code === "ABCD-EFGH-JKLM" ? stored[0] ?? null : null,
}));
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
		prismaMock.user.findUnique.mockResolvedValue({
			twoFactorEnabled: true,
			twoFactorSecret: "secret",
			status: "ACTIVE",
			username: "admin",
			mustChangePassword: false,
			currentTeamId: null,
			twoFactorRecoveryCodes: ["recovery-hash"],
			roles: [{ role: { key: "admin" } }],
		});
		verifyTotpMock.mockReturnValue({ valid: true });
		prismaMock.user.updateMany.mockResolvedValue({ count: 1 });
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
		expect(createSessionTokenMock).toHaveBeenCalledWith(
			{
				userId: "u_1",
				username: "admin",
				roles: ["admin"],
				mustChangePassword: false,
				currentTeamId: null,
			},
			{ remember: false },
		);
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

	it("reloads live roles from DB instead of trusting the pending-2fa token snapshot", async () => {
		verifyPending2faTokenMock.mockResolvedValueOnce({
			...sessionPayload,
			roles: ["admin", "operator"],
			username: "stale-name",
			mustChangePassword: true,
		});
		prismaMock.user.findUnique.mockResolvedValueOnce({
			twoFactorEnabled: true,
			twoFactorSecret: "secret",
			status: "ACTIVE",
			username: "admin",
			mustChangePassword: false,
			currentTeamId: "team_1",
			roles: [{ role: { key: "viewer" } }],
		});

		const response = await POST(new Request("https://app.example.test/api/auth/2fa/verify-login", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
			body: JSON.stringify({ code: "123456" }),
		}));

		expect(response.status).toBe(200);
		expect(createSessionTokenMock).toHaveBeenCalledWith(
			{
				userId: "u_1",
				username: "admin",
				roles: ["viewer"],
				mustChangePassword: false,
				currentTeamId: "team_1",
			},
			{ remember: false },
		);
	});

	it("rejects when the user is disabled after password login but before 2FA", async () => {
		prismaMock.user.findUnique.mockResolvedValueOnce({
			twoFactorEnabled: true,
			twoFactorSecret: "secret",
			status: "DISABLED",
			username: "admin",
			mustChangePassword: false,
			currentTeamId: null,
			roles: [{ role: { key: "admin" } }],
		});

		const response = await POST(new Request("https://app.example.test/api/auth/2fa/verify-login", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ code: "123456" }),
		}));

		expect(response.status).toBe(401);
		expect(createSessionTokenMock).not.toHaveBeenCalled();
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
		expect(createSessionTokenMock).toHaveBeenCalledWith(
			{
				userId: "u_1",
				username: "admin",
				roles: ["admin"],
				mustChangePassword: false,
				currentTeamId: null,
			},
			{ remember: true },
		);
		expect(getConfiguredSessionTtlSecondsMock).toHaveBeenCalledWith(true);
		const cookies = response.headers.getSetCookie().join("\n");
		expect(cookies).toContain("vcontrolhub_session=session-token");
		expect(cookies).toContain("vcontrolhub_csrf=csrf-token");
		expect(cookies).toContain("Max-Age=2592000");
	});

	it("accepts a recovery code once and atomically removes it", async () => {
		verifyTotpMock.mockReturnValueOnce({ valid: false });

		const response = await POST(new Request("https://app.example.test/api/auth/2fa/verify-login", {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
			body: JSON.stringify({ code: "ABCD-EFGH-JKLM" }),
		}));

		expect(response.status).toBe(200);
		expect(prismaMock.user.updateMany).toHaveBeenCalledWith({
			where: { id: "u_1", twoFactorRecoveryCodes: { equals: ["recovery-hash"] } },
			data: { twoFactorRecoveryCodes: [] },
		});
		expect(auditUserActionMock).toHaveBeenCalledWith(
			"u_1",
			"auth.login_2fa_recovery_ok",
			expect.any(Object),
			undefined,
			null,
		);
	});
});
