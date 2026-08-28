import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiSession: vi.fn(),
		userFindUnique: vi.fn(),
		generateSecret: vi.fn(),
		createEnrollmentToken: vi.fn(),
	},
}));

vi.mock("@/lib/auth/api-session", () => ({
	requireApiSession: mocks.requireApiSession,

  isSessionPayload: (value: unknown) => Boolean(value),
}));
vi.mock("@/lib/db", () => ({
	prisma: { user: { findUnique: mocks.userFindUnique } },
}));
vi.mock("otplib", () => ({
	generateSecret: mocks.generateSecret,
}));
vi.mock("@/lib/auth/two-factor-enrollment", () => ({
	createTwoFactorEnrollmentToken: mocks.createEnrollmentToken,
}));

const route = await import("../route");

const session = { userId: "u1", username: "alice" };

describe("/api/auth/2fa/setup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiSession.mockResolvedValue(session);
		mocks.userFindUnique.mockResolvedValue({ twoFactorEnabled: false });
		mocks.generateSecret.mockReturnValue("SECRETABC123");
		mocks.createEnrollmentToken.mockReturnValue("ticket.signature");
	});

	describe("POST", () => {
		it("generates a new TOTP secret, otpauth URL and enrollment ticket", async () => {
			const res = await route.POST(new Request("http://local/api/auth/2fa/setup", { method: "POST" }));
			const json = await res.json();
			expect(res.status).toBe(200);
			expect(mocks.userFindUnique).toHaveBeenCalledWith(
				expect.objectContaining({ where: { id: "u1" } }),
			);
			expect(mocks.generateSecret).toHaveBeenCalled();
			expect(json.secret).toBe("SECRETABC123");
			expect(json.otpauthUrl).toContain("otpauth://totp/");
			expect(json.otpauthUrl).toContain("secret=SECRETABC123");
			expect(json.qrDataUrl).toMatch(/^data:image\/png;base64,/);
			// The ticket binds the generated seed to this user, so `enable` never has
			// to trust a seed coming back from the browser.
			expect(mocks.createEnrollmentToken).toHaveBeenCalledWith({
				userId: "u1",
				secret: "SECRETABC123",
			});
			expect(json.enrollmentToken).toBe("ticket.signature");
		});

		it("returns 400 when 2FA is already enabled", async () => {
			mocks.userFindUnique.mockResolvedValueOnce({ twoFactorEnabled: true });
			const res = await route.POST(new Request("http://local/api/auth/2fa/setup", { method: "POST" }));
			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error).toMatch(/双因素认证已启用|Two-factor authentication is already enabled/);
			expect(mocks.createEnrollmentToken).not.toHaveBeenCalled();
		});

		it("returns 401 when not authenticated", async () => {
			mocks.requireApiSession.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: "未登录" }), { status: 401 }),
			);
			const res = await route.POST(new Request("http://local/api/auth/2fa/setup", { method: "POST" }));
			expect(res.status).toBe(401);
			expect(mocks.generateSecret).not.toHaveBeenCalled();
		});
	});

	it("exposes no code-verification endpoint (the PUT oracle is gone)", () => {
		// The old PUT answered `{ valid }` for any (code, secret) pair the caller
		// chose: unlimited tries against arbitrary seeds, and self-referential when
		// the caller picked the seed. `enable` does the verification now.
		expect("PUT" in route).toBe(false);
	});
});
