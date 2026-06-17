/**
 * TR-031 E01: /api/cost/snapshots route tests.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		listRecentSnapshots: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));

vi.mock("@/lib/cost/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/cost/service")>();
	return {
		...actual,
		listRecentSnapshots: mocks.listRecentSnapshots,
	};
});

const route = await import("../route");

const session = { userId: "u1", username: "alice", user: { id: "u1" } };

const SAMPLE = [
	{
		snapshotDate: "2026-06-15",
		totalAmount: "150.00",
		byCategory: {
			vps: "100.00",
			bandwidth: "30.00",
			storage: "20.00",
			other: "0.00",
		},
		entryCount: 5,
	},
];

describe("/api/cost/snapshots", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session });
		mocks.listRecentSnapshots.mockResolvedValue(SAMPLE);
	});

	it("GET requires cost:read and returns the snapshot list", async () => {
		const res = await route.GET(new Request("http://local/api/cost/snapshots"));
		expect(res.status).toBe(200);
		expect(mocks.requireApiPermission).toHaveBeenCalledWith("cost:read");
		const body = await res.json();
		expect(body.snapshots).toEqual(SAMPLE);
	});

	it("GET forwards limit to the service", async () => {
		const res = await route.GET(
			new Request("http://local/api/cost/snapshots?limit=7"),
		);
		expect(res.status).toBe(200);
		expect(mocks.listRecentSnapshots).toHaveBeenCalledWith(7);
	});

	it("GET returns 400 when limit is out of range", async () => {
		const res = await route.GET(
			new Request("http://local/api/cost/snapshots?limit=0"),
		);
		expect(res.status).toBe(400);
		expect(mocks.listRecentSnapshots).not.toHaveBeenCalled();
	});

	it("GET returns 403 when the caller lacks cost:read", async () => {
		mocks.requireApiPermission.mockResolvedValueOnce(
			new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
		);
		const res = await route.GET(new Request("http://local/api/cost/snapshots"));
		expect(res.status).toBe(403);
	});
});
