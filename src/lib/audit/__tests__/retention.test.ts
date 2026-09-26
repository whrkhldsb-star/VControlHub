import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
	prismaMock: {
		auditLog: {
			findMany: vi.fn(async (_args?: {
				where: { createdAt: { lt: Date } };
				orderBy: Array<Record<string, string>>;
				take: number;
			}): Promise<Array<{ id: string }>> => []),
			deleteMany: vi.fn(async (): Promise<{ count: number }> => ({ count: 0 })),
		},
	},
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/config/env", () => ({
	config: {
		audit: { retentionDays: 90, pruneBatchSize: 1_000 },
	},
}));

import { pruneAuditLogs } from "../retention";

const ids = (prefix: string, count: number) =>
	Array.from({ length: count }, (_, index) => ({ id: `${prefix}-${index}` }));

describe("pruneAuditLogs", () => {
	beforeEach(() => {
		prismaMock.auditLog.findMany.mockReset();
		prismaMock.auditLog.deleteMany.mockReset();
		prismaMock.auditLog.findMany.mockResolvedValue([]);
		prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 0 });
	});

	it("does not query or delete when retention is disabled", async () => {
		expect(await pruneAuditLogs({ retentionDays: 0 })).toEqual({ deleted: 0, retentionDays: 0, truncated: false });
		expect(prismaMock.auditLog.findMany).not.toHaveBeenCalled();
		expect(prismaMock.auditLog.deleteMany).not.toHaveBeenCalled();
	});

	it("selects a bounded batch of old IDs and deletes only those rows", async () => {
		prismaMock.auditLog.findMany.mockResolvedValueOnce(ids("old", 2));
		prismaMock.auditLog.deleteMany.mockResolvedValueOnce({ count: 2 });

		const result = await pruneAuditLogs({ retentionDays: 90, batchSize: 100 });

		expect(result).toEqual({ deleted: 2, retentionDays: 90, truncated: false });
		const selection = prismaMock.auditLog.findMany.mock.calls[0]![0]!;
		expect(selection.take).toBe(100);
		expect(selection.orderBy).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
		expect(Date.now() - selection.where.createdAt.lt.getTime()).toBeGreaterThan(89 * 24 * 60 * 60 * 1000);
		expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledWith({
			where: { id: { in: ["old-0", "old-1"] } },
		});
	});

	it("continues after full batches and stops on a short selection", async () => {
		prismaMock.auditLog.findMany
			.mockResolvedValueOnce(ids("first", 100))
			.mockResolvedValueOnce(ids("second", 100))
			.mockResolvedValueOnce(ids("last", 20));
		prismaMock.auditLog.deleteMany
			.mockResolvedValueOnce({ count: 100 })
			.mockResolvedValueOnce({ count: 100 })
			.mockResolvedValueOnce({ count: 20 });

		const result = await pruneAuditLogs({ retentionDays: 90, batchSize: 100 });

		expect(result).toEqual({ deleted: 220, retentionDays: 90, truncated: false });
		expect(prismaMock.auditLog.findMany).toHaveBeenCalledTimes(3);
		expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledTimes(3);
	});

	it("caps a sweep at forty bounded delete statements", async () => {
		prismaMock.auditLog.findMany.mockResolvedValue(ids("batch", 100));
		prismaMock.auditLog.deleteMany.mockResolvedValue({ count: 100 });

		const result = await pruneAuditLogs({ retentionDays: 90, batchSize: 100 });

		expect(result).toEqual({ deleted: 4_000, retentionDays: 90, truncated: true });
		expect(prismaMock.auditLog.findMany).toHaveBeenCalledTimes(40);
		expect(prismaMock.auditLog.deleteMany).toHaveBeenCalledTimes(40);
	});

	it("clamps oversized batch sizes to twenty thousand IDs", async () => {
		await pruneAuditLogs({ batchSize: 999_999 });
		expect(prismaMock.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20_000 }));
	});
});
