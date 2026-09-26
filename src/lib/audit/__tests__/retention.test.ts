import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
	prismaMock: {
		auditLog: {
			deleteMany: vi.fn(
				async (_args?: { where: { createdAt: { lt: Date } } }) => ({ count: 0 }),
			),
		},
	},
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/config/env", () => ({
	config: {
		audit: {
			retentionDays: 90,
			pruneBatchSize: 1_000,
		},
	},
}));

import { pruneAuditLogs } from "../retention";

describe("pruneAuditLogs", () => {
	beforeEach(() => {
		prismaMock.auditLog.deleteMany.mockClear();
		prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 0 });
	});

	it("is a no-op when retention is disabled (0 days)", async () => {
		const result = await pruneAuditLogs({ retentionDays: 0 });
		expect(result).toEqual({ deleted: 0, retentionDays: 0, truncated: false });
		expect(prismaMock.auditLog.deleteMany).not.toHaveBeenCalled();
	});

	it("deletes rows older than the retention cutoff in one pass when under the batch cap", async () => {
		let calls = 0;
		prismaMock.auditLog.deleteMany.mockImplementation(async (args?: { where: { createdAt: { lt: Date } } }) => {
			calls++;
			// Cutoff must be ~90 days ago.
			const cutoff = args?.where.createdAt.lt;
			expect(cutoff && Date.now() - cutoff.getTime()).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
			return { count: 500 };
		});

		const result = await pruneAuditLogs({ retentionDays: 90, batchSize: 1_000 });
		expect(result.deleted).toBe(500);
		expect(result.truncated).toBe(false);
		// A partial batch ends the sweep — no probe call needed.
		expect(calls).toBe(1);
	});

	it("loops bounded batches until the backlog is drained", async () => {
		let calls = 0;
		prismaMock.auditLog.deleteMany.mockImplementation(async () => {
			calls++;
			// Two full batches, then a partial one.
			return { count: calls <= 2 ? 1_000 : 120 };
		});

		const result = await pruneAuditLogs({ retentionDays: 90, batchSize: 1_000 });
		expect(calls).toBe(3);
		expect(result.deleted).toBe(2_120);
		expect(result.truncated).toBe(false);
	});

	it("stops at the sweep batch cap and reports truncation", async () => {
		prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 1_000 });
		// MAX_BATCHES_PER_SWEEP=40 with a full batch every time → truncated.
		const result = await pruneAuditLogs({ retentionDays: 90, batchSize: 1_000 });
		expect(result.truncated).toBe(true);
		expect(result.deleted).toBe(40_000);
	});

	it("clamps an oversized batch size to the hard ceiling", async () => {
		await pruneAuditLogs({ batchSize: 999_999 });
		expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledWith({
			where: { createdAt: expect.anything() },
		});
	});
});
