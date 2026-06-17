/**
 * TR-031 E01: /api/cost/summary route tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		summarizeMonth: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));

vi.mock("@/lib/cost/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/cost/service")>();
	return {
		...actual,
		summarizeMonth: mocks.summarizeMonth,
	};
});

const route = await import("../route");

const session = { userId: "u1", username: "alice", user: { id: "u1" } };

const SAMPLE_SUMMARY = {
	month: "2026-06",
	currency: "CNY" as const,
	totalAmount: "170.00",
	byCategory: {
		vps: "100.00",
		bandwidth: "50.00",
		storage: "20.00",
		other: "0.00",
	},
	entryCount: 3,
	rangeStart: "2026-06-01",
	rangeEnd: "2026-06-30",
};

describe("/api/cost/summary", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.summarizeMonth.mockResolvedValue(SAMPLE_SUMMARY);
	});

	it("GET requires cost:read and returns the monthly summary", async () => {
		const res = await route.GET(
			new Request("http://local/api/cost/summary?month=2026-06"),
		);
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("cost:read");
		expect(mocks.summarizeMonth).toHaveBeenCalledWith("2026-06", undefined);
		const body = await res.json();
		expect(body.summary).toEqual(SAMPLE_SUMMARY);
	});

	it("GET forwards currency parameter to the service", async () => {
		const res = await route.GET(
			new Request("http://local/api/cost/summary?month=2026-06&currency=USD"),
		);
		expect(res.status).toBe(200);
		expect(mocks.summarizeMonth).toHaveBeenCalledWith("2026-06", "USD");
	});

	it("GET returns 400 when month is missing", async () => {
		const res = await route.GET(new Request("http://local/api/cost/summary"));
		expect(res.status).toBe(400);
		expect(mocks.summarizeMonth).not.toHaveBeenCalled();
	});

	it("GET returns 400 when month is malformed", async () => {
		const res = await route.GET(
			new Request("http://local/api/cost/summary?month=2026-13"),
		);
		expect(res.status).toBe(400);
	});

	it("GET returns 400 when currency is invalid", async () => {
		const res = await route.GET(
			new Request("http://local/api/cost/summary?month=2026-06&currency=BTC"),
		);
		expect(res.status).toBe(400);
	});
});
