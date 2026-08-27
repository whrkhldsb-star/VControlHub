import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The durable `traffic.sample` worker owns traffic_snapshots. This route keeps a
 * fallback write for worker-less deployments, and these tests pin the two things
 * that used to make it harmful: one row per request (the /traffic page issues two
 * per refresh, per open tab) and rows whose rate was diffed over a sub-second
 * window between two polls sharing the process-wide previous-sample slot.
 *
 * The local counters come from the real /proc/net/dev, as everywhere else in the
 * traffic tests — only the cadence is asserted here, never the byte values.
 */
const trafficSnapshotCreate = vi.fn(async () => ({ id: "snap" }));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: vi.fn(async () => ({
		session: { userId: "u1", roles: ["viewer"] },
	})),
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		storageNode: { findMany: vi.fn(async () => []) },
		server: { findMany: vi.fn(async () => []) },
		trafficSnapshot: { create: trafficSnapshotCreate },
	},
}));

/** Fresh module instance, so the throttle map starts empty. */
async function loadRoute() {
	vi.resetModules();
	const mod = await import("../route");
	return mod.GET;
}

function request() {
	return new Request("http://localhost/api/traffic/summary") as Parameters<
		Awaited<ReturnType<typeof loadRoute>>
	>[0];
}

describe("traffic summary history write", () => {
	beforeEach(() => {
		trafficSnapshotCreate.mockClear();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("skips the first sample, whose interval is unknown", async () => {
		const GET = await loadRoute();
		await GET(request());
		expect(trafficSnapshotCreate).not.toHaveBeenCalled();
	});

	it("writes at most one row per interface per worker interval", async () => {
		const GET = await loadRoute();
		await GET(request());
		vi.advanceTimersByTime(2_000);

		await GET(request());
		expect(trafficSnapshotCreate).toHaveBeenCalledTimes(1);
		expect(trafficSnapshotCreate).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ source: "local", serverId: null }),
			}),
		);

		// Two refresh cycles of the /traffic page — four requests, because the page
		// polls `?include=remote` alongside the plain summary. None may persist.
		for (let i = 0; i < 2; i++) {
			vi.advanceTimersByTime(30_000);
			await GET(request());
			await GET(request());
		}
		expect(trafficSnapshotCreate).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(5 * 60_000);
		await GET(request());
		expect(trafficSnapshotCreate).toHaveBeenCalledTimes(2);
	});

	it("does not persist a rate diffed over a sub-second window", async () => {
		const GET = await loadRoute();
		await GET(request());
		vi.advanceTimersByTime(2_000);
		await GET(request());
		trafficSnapshotCreate.mockClear();

		// Well past the throttle, but two polls land in the same millisecond: the
		// second one's rate would be a delta over ~0s.
		vi.advanceTimersByTime(6 * 60_000);
		await GET(request());
		await GET(request());
		expect(trafficSnapshotCreate).toHaveBeenCalledTimes(1);
	});
});
