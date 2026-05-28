import { describe, expect, it, vi, beforeEach } from "vitest";

const { auth } = vi.hoisted(() => ({
	auth: {
		requireApiSession: vi.fn(),
		isSessionPayload: vi.fn(),
	},
}));

vi.mock("@/lib/auth/api-session", () => ({
	requireApiSession: auth.requireApiSession,
	isSessionPayload: auth.isSessionPayload,
}));

import { GET } from "../route";

describe("GET /api/docs/openapi.json", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		auth.requireApiSession.mockResolvedValue({ userId: "u1", username: "admin", permissions: ["*"] });
		auth.isSessionPayload.mockReturnValue(true);
	});

	it("serves the same authenticated OpenAPI spec URL embedded in the docs UI", async () => {
		const response = await GET();
		expect(response.status).toBe(200);

		const body = await response.json();
		expect(body.openapi).toBe("3.0.3");
		expect(body.info.title).toContain("API");
		expect(body.paths).toHaveProperty("/login");
	});
});
