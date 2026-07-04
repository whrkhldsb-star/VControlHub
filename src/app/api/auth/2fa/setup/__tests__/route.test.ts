import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiSession: vi.fn(),
		userFindUnique: vi.fn(),
		generateSecret: vi.fn(),
		verifyTOTP: vi.fn(),
	},
}));

vi.mock("@/lib/auth/api-session", () => ({
	requireApiSession: mocks.requireApiSession,
}));
vi.mock("@/lib/db", () => ({
	prisma: { user: { findUnique: mocks.userFindUnique } },
}));
vi.mock("otplib", () => ({
	generateSecret: mocks.generateSecret,
	verify: mocks.verifyTOTP,
}));

const route = await import("../route");

const session = { userId: "u1", username: "alice" };

describe("/api/auth/2fa/setup", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiSession.mockResolvedValue(session);
		mocks.userFindUnique.mockResolvedValue({ twoFactorEnabled: false });
		mocks.generateSecret.mockReturnValue("SECRETABC123");
		mocks.verifyTOTP.mockReturnValue(true);
	});

	describe("POST", () => {
		it("generates a new TOTP secret and otpauth URL", async () => {
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
		});

		it("returns 400 when 2FA is already enabled", async () => {
			mocks.userFindUnique.mockResolvedValueOnce({ twoFactorEnabled: true });
			const res = await route.POST(new Request("http://local/api/auth/2fa/setup", { method: "POST" }));
			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.error).toContain("已启用");
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

	describe("PUT", () => {
		it("verifies a TOTP code against a secret and returns valid=true", async () => {
			const res = await route.PUT(
				new Request("http://local/api/auth/2fa/setup", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: "123456", secret: "SECRETABC123" }),
				}),
			);
			const json = await res.json();
			expect(res.status).toBe(200);
			expect(mocks.verifyTOTP).toHaveBeenCalledWith({ token: "123456", secret: "SECRETABC123" });
			expect(json.valid).toBe(true);
		});

		it("returns valid=false for an incorrect code", async () => {
			mocks.verifyTOTP.mockReturnValueOnce(false);
			const res = await route.PUT(
				new Request("http://local/api/auth/2fa/setup", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: "000000", secret: "SECRETABC123" }),
				}),
			);
			const json = await res.json();
			expect(res.status).toBe(200);
			expect(json.valid).toBe(false);
		});

		it("returns 400 when code or secret is missing", async () => {
			const res = await route.PUT(
				new Request("http://local/api/auth/2fa/setup", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: "" }),
				}),
			);
			expect(res.status).toBe(400);
			expect(mocks.verifyTOTP).not.toHaveBeenCalled();
		});

		it("returns 401 when not authenticated", async () => {
			mocks.requireApiSession.mockResolvedValueOnce(
				new Response(JSON.stringify({ error: "未登录" }), { status: 401 }),
			);
			const res = await route.PUT(
				new Request("http://local/api/auth/2fa/setup", {
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ code: "123456", secret: "SECRETABC123" }),
				}),
			);
			expect(res.status).toBe(401);
			expect(mocks.verifyTOTP).not.toHaveBeenCalled();
		});
	});
});
