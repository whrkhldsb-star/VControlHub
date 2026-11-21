// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as notifications from "@/lib/notification/service";
import { ensureBudgetDeliveryTable } from "../budget-deliveries";
import { checkBudgetAlerts } from "../service-budgets";
import { prisma } from "@/lib/db";
import * as adapters from "../cloud-billing/adapters";
import { syncCloudBillingAccount } from "../cloud-billing/service";
import { createCostEntry, listRecentSnapshots, updateCostEntry } from "../service-entries";
import { upsertDailySnapshot } from "../service-snapshots";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("cost ledger recovery (PostgreSQL)", () => {
	const teamId = `billing-test-${randomUUID()}`;
	const session = { userId: teamId, roles: ["operator" as const], currentTeamId: teamId };
	const month = "2026-07";
	const effectiveDate = new Date("2026-07-01");
	const header = "date,amount,product,external_id";
	const rows = ["2026-07-01,7,vm,explicit", "2026-07-01,2,vm,", "2026-07-01,3,vm,"];
	const snapshotDate = new Date("2000-02-29");

	async function account(csv: string) {
		return prisma.cloudBillingAccount.create({ data: {
			name: "fixture", provider: "generic_csv", credentialsEnc: "{}", config: { sampleCsv: csv }, teamId,
		} });
	}
	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: teamId, slug: teamId, name: teamId } });
	});
	afterAll(async () => {
		await prisma.costEntry.deleteMany({ where: { teamId } });
		await prisma.cloudBillingAccount.deleteMany({ where: { teamId } });
		await prisma.costSnapshot.deleteMany({ where: { snapshotDate } });
		await prisma.costBudget.deleteMany({ where: { teamId } });
		await prisma.user.deleteMany({ where: { id: { startsWith: teamId } } });
		await prisma.identityTemplate.deleteMany({ where: { id: teamId } });
		await prisma.team.delete({ where: { id: teamId } });
		await prisma.$disconnect();
	});

	it("migrates overlapping old ordinals by amount and preserves entry IDs across reorderings", async () => {
		const billing = await account([header, ...rows].join("\n"));
		await syncCloudBillingAccount(billing.id, month, session);
		const prefix = `${billing.id}:${adapters.csvNaturalKeyPrefix("2026-07-01", "vm")}`;
		const lookup = (ordinal: number) => ({ sourceType_sourceRef_effectiveDate: { sourceType: "cloud_billing", sourceRef: prefix + ordinal, effectiveDate } });
		const second = await prisma.costEntry.update({ where: lookup(2), data: { sourceRef: prefix + "3", tags: [] } });
		const first = await prisma.costEntry.update({ where: lookup(1), data: { sourceRef: prefix + "2", tags: [] } });
		await prisma.cloudBillingAccount.update({ where: { id: billing.id }, data: { config: { sampleCsv: [header, rows[1], rows[2], rows[0]].join("\n") } } });
		for (let repeat = 0; repeat < 2; repeat++) {
			await syncCloudBillingAccount(billing.id, month, session);
			expect(await prisma.costEntry.findUnique({ where: lookup(1) })).toMatchObject({ id: first.id });
			expect(await prisma.costEntry.findUnique({ where: lookup(2) })).toMatchObject({ id: second.id });
			expect(await prisma.costEntry.findUnique({ where: lookup(3) })).toBeNull();
		}
		// A pre-upgrade retry may already have produced both old and new keys.
		const { id: _id, ...data } = second;
		await prisma.costEntry.create({ data });
		await expect(syncCloudBillingAccount(billing.id, month, session)).rejects.toMatchObject({ status: 409 });
		await syncCloudBillingAccount(billing.id, month, session, true);
		expect(await prisma.costEntry.count({ where: { teamId, sourceRef: { startsWith: billing.id + ":" } } })).toBe(3);

		await prisma.costEntry.update({ where: lookup(2), data: { sourceRef: prefix + "3", amount: "999", tags: [] } });
		await expect(syncCloudBillingAccount(billing.id, month, session)).rejects.toThrow(/reconcile|核对/);
		expect((await prisma.costEntry.findUniqueOrThrow({ where: lookup(3) })).amount.toString()).toBe("999");
	});

	it("recovers abandoned runs and rolls back earlier rows on a database failure mid-batch", async () => {
		const billing = await account([header, ...rows].join("\n"));
		const interrupted = await prisma.cloudBillingSyncRun.create({ data: { accountId: billing.id, month, status: "running" } });
		const items = adapters.parseBillingCsv([header, ...rows].join("\n"), { currency: "USD", providerLabel: "CSV" });
		items[1]!.amount = "10000000000.00"; // Refused by the real Decimal(12,2) after the first insert.
		const fetch = vi.spyOn(adapters, "fetchCloudBillingItems").mockResolvedValueOnce({ items, warnings: [] });
		try { await expect(syncCloudBillingAccount(billing.id, month, session)).rejects.toThrow(); }
		finally { fetch.mockRestore(); }
		expect(await prisma.costEntry.count({ where: { sourceRef: { startsWith: billing.id + ":" } } })).toBe(0);
		expect(await prisma.cloudBillingSyncRun.findUnique({ where: { id: interrupted.id } })).toMatchObject({ status: "error", finishedAt: expect.any(Date) });
		expect(await prisma.cloudBillingAccount.findUnique({ where: { id: billing.id } })).toMatchObject({ lastSyncStatus: "error", lastSyncImported: 0 });
		expect(await syncCloudBillingAccount(billing.id, month, session)).toMatchObject({
			account: { lastSyncImported: 3 }, run: { status: "ok", imported: 3 },
		});
	});

	it("discards a late publisher after its running record has been recovered", async () => {
		const csv = [header, ...rows].join("\n");
		const billing = await account(csv);
		const fetch = vi.spyOn(adapters, "fetchCloudBillingItems").mockImplementationOnce(async () => {
			// Model recovery on another connection after the original session lock
			// was lost, while the slow provider request was still outstanding.
			await prisma.$transaction([
				prisma.cloudBillingSyncRun.updateMany({ where: { accountId: billing.id, month, status: "running" },
					data: { status: "error", finishedAt: new Date(), errorMessage: "recovered" } }),
				prisma.cloudBillingAccount.update({ where: { id: billing.id },
					data: { lastSyncStatus: "error", lastSyncError: "recovered" } }),
			]);
			return { items: adapters.parseBillingCsv(csv, { currency: "USD", providerLabel: "CSV" }), warnings: [] };
		});
		try { await expect(syncCloudBillingAccount(billing.id, month, session)).rejects.toMatchObject({ status: 409 }); }
		finally { fetch.mockRestore(); }
		expect(await prisma.costEntry.count({ where: { sourceRef: { startsWith: billing.id + ":" } } })).toBe(0);
		expect(await prisma.cloudBillingAccount.findUniqueOrThrow({ where: { id: billing.id } })).toMatchObject({ lastSyncError: "recovered" });
	});

	it("keeps source dates fixed and records independent, tenant-scoped debit and credit adjustments", async () => {
		const billing = await account([header, rows[0]].join("\n"));
		await syncCloudBillingAccount(billing.id, month, session);
		const source = await prisma.costEntry.findFirstOrThrow({ where: { teamId, sourceRef: billing.id + ":csv:id:explicit" } });
		await expect(updateCostEntry(source.id, { effectiveDate: "2026-07-02" }, session)).rejects.toThrow(/source|来源/);
		const correction = { category: "other", provider: "CSV", currency: "USD", effectiveDate: "2026-07-02", amount: "-2.00", adjustmentForId: source.id };
		await expect(createCostEntry(correction, null, { ...session, currentTeamId: "another-team" })).rejects.toMatchObject({ status: 404 });
		const credit = await createCostEntry(correction, null, session);
		const debit = await createCostEntry({ ...correction, amount: "1.00" }, null, session);
		const updated = await updateCostEntry(credit.id, { provider: "corrected" }, session);
		expect(updated).toMatchObject({ amount: "-2.00", teamId, tags: expect.arrayContaining(["adjustment-for:" + source.id]) });
		expect(debit.sourceType).toBe("manual");
		await syncCloudBillingAccount(billing.id, month, session);
		expect(await prisma.costEntry.count({ where: { sourceRef: source.sourceRef } })).toBe(1);
	});

	it("commits one delivery per manager across pages, overlapping checks and inbox deletion", async () => {
		const ids = Array.from({ length: 1001 }, (_, i) => teamId + "-" + String(i).padStart(4, "0"));
		await prisma.identityTemplate.create({ data: { id: teamId, name: teamId, permissions: ["cost:manage"] } });
		await prisma.user.createMany({ data: ids.map(id => ({ id, username: id, passwordHash: "fixture", status: "ACTIVE" })) });
		await prisma.teamMember.createMany({ data: ids.map(userId => ({ teamId, userId, identityTemplateId: teamId })) });
		const budget = await prisma.costBudget.create({ data: { teamId, name: "Compute", category: "storage", currency: "EUR", limitAmount: "100" } });
		const entry = await prisma.costEntry.create({ data: { teamId, category: "storage", currency: "EUR", provider: "fixture", amount: "79.96", effectiveDate } });
		expect((await checkBudgetAlerts(effectiveDate, session)).triggered).toBe(0);
		await prisma.costEntry.update({ where: { id: entry.id }, data: { amount: "80" } });
		const actionUrl = `/cost-summary?budget=${budget.id}&periodStart=2026-07-01`;
		const previous = { teamId, type: "system", actionUrl, title: "existing", message: "existing" };
		const legacy = await prisma.notification.create({ data: { ...previous, userId: ids[0]! } });
		await ensureBudgetDeliveryTable({ backfill: true });
		await prisma.notification.delete({ where: { id: legacy.id } });
		// A previous-version process can still deliver during a rolling upgrade.
		await prisma.notification.create({ data: { ...previous, userId: ids[1]! } });
		const push = vi.spyOn(notifications, "announceStoredNotifications").mockResolvedValue(undefined);
		try {
			const concurrent = await Promise.all([checkBudgetAlerts(effectiveDate, session), checkBudgetAlerts(effectiveDate, session)]);
			expect(concurrent.reduce((sum, r) => sum + r.notificationsSent, 0)).toBe(999);
			expect(await prisma.notification.count({ where: { teamId, actionUrl } })).toBe(1000);
			await prisma.notification.deleteMany({ where: { teamId, actionUrl } });
			expect(await checkBudgetAlerts(effectiveDate, session)).toMatchObject({ notificationsSent: 0, duplicatesSkipped: 1001 });
		} finally { push.mockRestore(); }
	}, 30_000);

	it("round-trips overflow totals without overflowing the Decimal(14,2) column", async () => {
		const exact = "1009999999998.99"; // 101 * 9,999,999,999.99
		const byCategory = { vps: exact, bandwidth: "0.00", storage: "0.00", other: "0.00" };
		const snapshot = await upsertDailySnapshot({ snapshotDate, byCategory, totalAmount: exact, entryCount: 101 });
		expect(snapshot.totalAmount).toBe(exact);
		const saved = await prisma.costSnapshot.findUniqueOrThrow({ where: { snapshotDate } });
		expect(saved.totalAmount.toFixed(2)).toBe("999999999999.99");
		expect(await listRecentSnapshots(365)).toContainEqual({ snapshotDate: "2000-02-29", totalAmount: exact, byCategory, entryCount: 101 });
		expect((await upsertDailySnapshot({ snapshotDate, byCategory: { ...byCategory, vps: "1.00" }, totalAmount: "1.00", entryCount: 1 })).totalAmount).toBe("1.00");
	});
});
