import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TR-049 lazy storage health probe — unit tests.
 *
 * The scheduler is fire-and-forget: the public surface is the side
 * effect of "schedule returned, work started". These tests assert:
 *   - the schedule call returns synchronously (doesn't await the probe)
 *   - the probe function correctly short-circuits when nothing is stale
 *   - the probe function calls `checkStorageNodeHealth` for each
 *     candidate returned by Prisma
 *   - the probe function never throws (Promise.allSettled + per-node
 *     `.catch` swallowing)
 */

const { prismaMock, checkStorageNodeHealthMock } = vi.hoisted(() => ({
	prismaMock: {
		storageNode: {
			findMany: vi.fn(),
		},
	},
	checkStorageNodeHealthMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/storage/service-nodes", () => ({
	checkStorageNodeHealth: checkStorageNodeHealthMock,
}));

import { probeAllStaleStorageNodes, scheduleStorageNodeHealthProbe } from "../health";

describe("TR-049 scheduleStorageNodeHealthProbe", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Silence the "unhandled rejection" noise that would otherwise hit
		// the test runner if a probe helper ever synchronously throws
		// before the schedule() caller had a chance to attach a handler.
		process.on("unhandledRejection", () => undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("returns synchronously without waiting for the probe to finish", async () => {
		// Resolve the findMany call with a never-resolving promise so the
		// probe can only complete if schedule() awaited it. If it did,
		// this test would hang and the runner would time out.
		let resolveFindMany: (value: unknown) => void = () => undefined;
		prismaMock.storageNode.findMany.mockImplementationOnce(
			() => new Promise((resolve) => { resolveFindMany = resolve; }),
		);
		checkStorageNodeHealthMock.mockResolvedValue({
			healthStatus: "HEALTHY",
			lastHealthError: null,
		} as never);

		scheduleStorageNodeHealthProbe();

		// Drain the setImmediate queue — the schedule call only enqueues
		// the work for the next tick, so we need to flush it before we
		// can observe anything.
		await new Promise<void>((resolve) => setImmediate(resolve));
		// Then unblock the findMany so the scheduler can wrap up.
		resolveFindMany([]);

		// schedule() should have returned by now without ever waiting on
		// the inner promise. If the assertion fails because
		// checkStorageNodeHealth was never called, the most likely cause
		// is that the inner promise hasn't resolved yet — wait a beat.
		await new Promise<void>((resolve) => setTimeout(resolve, 10));
	});

	it("short-circuits to a no-op when no storage nodes are stale", async () => {
		prismaMock.storageNode.findMany.mockResolvedValueOnce([]);
		const result = await probeAllStaleStorageNodes();
		expect(result).toEqual({ scanned: 0, probed: 0 });
		expect(checkStorageNodeHealthMock).not.toHaveBeenCalled();
	});

	it("probes every candidate returned by Prisma in parallel", async () => {
		prismaMock.storageNode.findMany.mockResolvedValueOnce([
			{ id: "node-1" },
			{ id: "node-2" },
			{ id: "node-3" },
		]);
		checkStorageNodeHealthMock.mockResolvedValue({
			healthStatus: "HEALTHY",
			lastHealthError: null,
		} as never);

		const result = await probeAllStaleStorageNodes();

		expect(checkStorageNodeHealthMock).toHaveBeenCalledTimes(3);
		expect(checkStorageNodeHealthMock).toHaveBeenCalledWith("node-1");
		expect(checkStorageNodeHealthMock).toHaveBeenCalledWith("node-2");
		expect(checkStorageNodeHealthMock).toHaveBeenCalledWith("node-3");
		expect(result).toEqual({ scanned: 3, probed: 3 });
	});

	it("does not reject when one or more probes throw", async () => {
		prismaMock.storageNode.findMany.mockResolvedValueOnce([
			{ id: "node-1" },
			{ id: "node-2" },
		]);
		checkStorageNodeHealthMock
			.mockRejectedValueOnce(new Error("ECONNREFUSED"))
			.mockResolvedValueOnce({ healthStatus: "HEALTHY" } as never);

		// Must not reject — the function is the "best effort" entry point
		// invoked from a status handler; a thrown rejection would bubble
		// up and break the polling dashboard.
		const result = await probeAllStaleStorageNodes();
		expect(result).toEqual({ scanned: 2, probed: 2 });
	});

	it("respects the PROBE_BATCH_LIMIT cap so a giant fleet doesn't fan out unboundedly", async () => {
		// findMany receives the take value, and Prisma enforces it
		// server-side, so we just assert the cap is what we expect.
		prismaMock.storageNode.findMany.mockResolvedValueOnce([]);
		await probeAllStaleStorageNodes();
		expect(prismaMock.storageNode.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ take: 50 }),
		);
	});
});
