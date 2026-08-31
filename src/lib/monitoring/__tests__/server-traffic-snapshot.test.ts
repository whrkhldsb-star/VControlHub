import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `persistServerTrafficFromMetrics`.
 *
 * The module holds a process-level `Map` of the previous counter reading per
 * `serverId:iface` so it can turn absolute NIC counters into a rate. Two things
 * make that cache worth testing:
 *
 * 1. It must be evicted. A deleted server or renamed interface otherwise keeps
 *    its entry for the life of the worker, and — the part that corrupts data —
 *    a baseline left over from hours ago makes `calculateTrafficRate` divide the
 *    counter delta by that whole span, writing a long-run average into
 *    `rxRateBps`/`txRateBps` as though it were current throughput. That value
 *    then feeds the monthly rollup.
 * 2. Counters are persisted as BigInt and must be clamped: a negative or
 *    fractional reading from an agent would otherwise reach Prisma.
 *
 * `calculateTrafficRate` is kept real — the rate arithmetic is the thing under
 * test, and it has its own unit tests in `./traffic`.
 */
const mocks = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { trafficSnapshot: { create: mocks.create } } }));

import { persistServerTrafficFromMetrics } from "../server-traffic-snapshot";

type Metrics = Parameters<typeof persistServerTrafficFromMetrics>[1];

function metrics(input: {
	iface?: string;
	rxBytes?: number;
	txBytes?: number;
	timestamp: string;
}): Metrics {
	return {
		timestamp: input.timestamp,
		network: [
			{
				iface: input.iface ?? "eth0",
				rxBytes: input.rxBytes ?? 0,
				txBytes: input.txBytes ?? 0,
			},
		],
	} as unknown as Metrics;
}

function lastData() {
	return mocks.create.mock.calls[mocks.create.mock.calls.length - 1]![0].data as Record<string, unknown>;
}

describe("persistServerTrafficFromMetrics", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.create.mockReset();
		mocks.create.mockResolvedValue({ id: "snap" });
	});

	it("returns false without writing when the host reports no interfaces", async () => {
		const empty = { timestamp: "2026-08-31T12:00:00.000Z", network: [] } as unknown as Metrics;
		await expect(persistServerTrafficFromMetrics("srv_no_nic", empty)).resolves.toBe(false);
		expect(mocks.create).not.toHaveBeenCalled();
	});

	it("records zero rates for the first sample of an interface", async () => {
		// No baseline yet — reporting a rate here would be inventing one.
		await persistServerTrafficFromMetrics("srv_a", metrics({ rxBytes: 1_000, txBytes: 500, timestamp: "2026-08-31T12:00:00.000Z" }));
		expect(lastData()).toMatchObject({
			source: "server",
			serverId: "srv_a",
			iface: "eth0",
			rxRateBps: 0,
			txRateBps: 0,
		});
	});

	it("computes the rate from the delta over the sample interval", async () => {
		await persistServerTrafficFromMetrics("srv_b", metrics({ rxBytes: 0, txBytes: 0, timestamp: "2026-08-31T12:00:00.000Z" }));
		await persistServerTrafficFromMetrics("srv_b", metrics({ rxBytes: 60_000, txBytes: 30_000, timestamp: "2026-08-31T12:01:00.000Z" }));
		expect(lastData()).toMatchObject({ rxRateBps: 1_000, txRateBps: 500 });
	});

	it("keys the cache per interface so two NICs do not share a baseline", async () => {
		await persistServerTrafficFromMetrics("srv_c", metrics({ iface: "eth0", rxBytes: 0, timestamp: "2026-08-31T12:00:00.000Z" }));
		await persistServerTrafficFromMetrics("srv_c", metrics({ iface: "eth1", rxBytes: 999_999, timestamp: "2026-08-31T12:00:30.000Z" }));
		// eth1 is new: its first sample must be rate 0, not a rate derived from eth0.
		expect(lastData()).toMatchObject({ iface: "eth1", rxRateBps: 0 });
	});

	it("keys the cache per server so two hosts do not share a baseline", async () => {
		await persistServerTrafficFromMetrics("srv_d1", metrics({ rxBytes: 0, timestamp: "2026-08-31T12:00:00.000Z" }));
		await persistServerTrafficFromMetrics("srv_d2", metrics({ rxBytes: 999_999, timestamp: "2026-08-31T12:00:30.000Z" }));
		expect(lastData()).toMatchObject({ serverId: "srv_d2", rxRateBps: 0 });
	});

	it("discards a baseline older than the TTL instead of averaging over the gap", async () => {
		// The regression: with a 3-hour-old baseline, 36 GB of traffic accumulated
		// over that whole window would be divided by the gap and written as the
		// *current* rate. After eviction the sample starts fresh at 0.
		await persistServerTrafficFromMetrics("srv_e", metrics({ rxBytes: 0, timestamp: "2026-08-31T09:00:00.000Z" }));
		await persistServerTrafficFromMetrics("srv_e", metrics({ rxBytes: 36_000_000_000, timestamp: "2026-08-31T12:00:00.000Z" }));
		expect(lastData()).toMatchObject({ rxRateBps: 0, txRateBps: 0 });
	});

	it("keeps a baseline that is still inside the TTL", async () => {
		await persistServerTrafficFromMetrics("srv_f", metrics({ rxBytes: 0, timestamp: "2026-08-31T12:00:00.000Z" }));
		await persistServerTrafficFromMetrics("srv_f", metrics({ rxBytes: 1_800_000, timestamp: "2026-08-31T12:30:00.000Z" }));
		expect(lastData()).toMatchObject({ rxRateBps: 1_000 });
	});

	it("evicts an unparseable cached timestamp rather than keeping it forever", async () => {
		await persistServerTrafficFromMetrics("srv_g", metrics({ rxBytes: 0, timestamp: "not-a-date" }));
		await persistServerTrafficFromMetrics("srv_g", metrics({ rxBytes: 60_000, timestamp: "2026-08-31T12:01:00.000Z" }));
		expect(lastData()).toMatchObject({ rxRateBps: 0 });
	});

	it("does not report a negative rate when counters reset on reboot", async () => {
		await persistServerTrafficFromMetrics("srv_h", metrics({ rxBytes: 10_000_000, timestamp: "2026-08-31T12:00:00.000Z" }));
		await persistServerTrafficFromMetrics("srv_h", metrics({ rxBytes: 1_000, timestamp: "2026-08-31T12:01:00.000Z" }));
		expect(lastData()).toMatchObject({ rxRateBps: 0, txRateBps: 0 });
	});

	it("stores the raw counters as BigInt", async () => {
		await persistServerTrafficFromMetrics("srv_i", metrics({ rxBytes: 1_234, txBytes: 5_678, timestamp: "2026-08-31T12:00:00.000Z" }));
		const data = lastData();
		expect(data.rxBytes).toBe(BigInt(1234));
		expect(data.txBytes).toBe(BigInt(5678));
	});

	it("clamps a negative or fractional counter before the BigInt conversion", async () => {
		// `BigInt(1.5)` throws and `BigInt(-1)` would persist a nonsense counter;
		// a misbehaving agent must not be able to do either.
		await persistServerTrafficFromMetrics("srv_j", metrics({ rxBytes: -5, txBytes: 12.9, timestamp: "2026-08-31T12:00:00.000Z" }));
		const data = lastData();
		expect(data.rxBytes).toBe(BigInt(0));
		expect(data.txBytes).toBe(BigInt(12));
	});

	it("returns true after a successful write", async () => {
		await expect(
			persistServerTrafficFromMetrics("srv_k", metrics({ timestamp: "2026-08-31T12:00:00.000Z" })),
		).resolves.toBe(true);
	});
});
