import { beforeEach, describe, expect, it, vi } from "vitest";

const delegates = vi.hoisted(() => {
	const make = () => ({ findMany: vi.fn(), deleteMany: vi.fn() });
	return {
		serverAgentJob: make(),
		mediaUploadSession: make(),
		playbookRun: make(),
		syncLog: make(),
		itsmEvent: make(),
		shareAccessLog: make(),
		cloudBillingSyncRun: make(),
	};
});
vi.mock("@/lib/db", () => ({ prisma: delegates }));
vi.mock("@/lib/config/env", () => ({ config: { retention: { logRetentionDays: null } } }));

import { LOG_RETENTION_TABLES, pruneLogTables } from "../log-retention";

const NOW = new Date("2026-10-05T00:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);

beforeEach(() => {
	for (const delegate of Object.values(delegates)) {
		delegate.findMany.mockReset().mockResolvedValue([]);
		delegate.deleteMany.mockReset().mockImplementation(async ({ where }) => ({ count: where.id.in.length }));
	}
});

describe("pruneLogTables", () => {
	it("deletes only terminal rows older than each table's retention", async () => {
		delegates.serverAgentJob.findMany.mockResolvedValueOnce([{ id: "j1" }, { id: "j2" }]);
		const result = await pruneLogTables({ now: NOW });
		expect(result.deleted).toEqual({ serverAgentJob: 2 });
		const agentWhere = delegates.serverAgentJob.findMany.mock.calls[0]![0].where;
		expect(agentWhere.status.in).toEqual(["COMPLETED", "FAILED", "CANCELLED"]);
		expect(agentWhere.createdAt.lt).toEqual(daysAgo(LOG_RETENTION_TABLES.serverAgentJob.days));
		expect(delegates.playbookRun.findMany.mock.calls[0]![0].where.status.in).not.toContain("running");
		expect(delegates.syncLog.findMany.mock.calls[0]![0].where.status.in).not.toContain("RUNNING");
		expect(delegates.mediaUploadSession.findMany.mock.calls[0]![0].where.status.in).not.toContain("UPLOADING");
		expect(delegates.shareAccessLog.findMany.mock.calls[0]![0].where.accessedAt.lt).toEqual(daysAgo(180));
		expect(delegates.serverAgentJob.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["j1", "j2"] } } });
	});

	it("works through a backlog in bounded batches and reports the table as truncated", async () => {
		const batch = Array.from({ length: 2_000 }, (_, index) => ({ id: `s${index}` }));
		delegates.shareAccessLog.findMany.mockResolvedValue(batch);
		const result = await pruneLogTables({ now: NOW });
		expect(delegates.shareAccessLog.findMany).toHaveBeenCalledTimes(10);
		expect(result.deleted.shareAccessLog).toBe(20_000);
		expect(result.truncated).toEqual(["shareAccessLog"]);
	});

	it("keeps going when one table fails and honours the 0-days kill switch", async () => {
		delegates.itsmEvent.findMany.mockRejectedValueOnce(new Error("db down"));
		const result = await pruneLogTables({ now: NOW });
		expect(result.failed).toEqual({ itsmEvent: "db down" });
		expect(delegates.cloudBillingSyncRun.findMany).toHaveBeenCalled();

		for (const delegate of Object.values(delegates)) delegate.findMany.mockClear();
		await pruneLogTables({ now: NOW, overrideDays: 0 });
		for (const delegate of Object.values(delegates)) expect(delegate.findMany).not.toHaveBeenCalled();
	});
});
