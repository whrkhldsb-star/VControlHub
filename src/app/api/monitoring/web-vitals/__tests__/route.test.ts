import { describe, expect, it, vi, beforeEach } from "vitest";

const { requireApiSessionMock, recordWebVitalMock } = vi.hoisted(() => ({
	requireApiSessionMock: vi.fn(async () => ({
		userId: "u1",
		username: "alice",
		roles: ["admin"],
		currentTeamId: null,
	})),
	recordWebVitalMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
	requireApiSession: requireApiSessionMock,

  isSessionPayload: (value: unknown) => Boolean(value),
}));

vi.mock("@/lib/monitoring/runtime-metrics", () => ({
	recordWebVital: recordWebVitalMock,
}));

import { POST } from "../route";

describe("POST /api/monitoring/web-vitals", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("records a valid web vital sample for authenticated users", async () => {
		const res = await POST(
			new Request("http://local/api/monitoring/web-vitals", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "LCP", value: 1234.5, rating: "good", path: "/" }),
			}),
		);
		expect(res.status).toBe(200);
		expect(recordWebVitalMock).toHaveBeenCalledWith(
			expect.objectContaining({ name: "LCP", value: 1234.5, rating: "good", path: "/" }),
		);
	});

	it("rejects invalid payload", async () => {
		const res = await POST(
			new Request("http://local/api/monitoring/web-vitals", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name: "NOPE", value: "x" }),
			}),
		);
		expect(res.status).toBe(400);
		expect(recordWebVitalMock).not.toHaveBeenCalled();
	});
});
