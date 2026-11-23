// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as notifications from "@/lib/notification/service";
import { ensureBudgetDeliveryTable } from "../budget-deliveries";
import { checkBudgetAlerts } from "../service-budgets";
import { prisma } from "@/lib/db";
import * as adapters from "../cloud-billing/adapters";
import { syncCloudBillingAccount, updateCloudBillingAccount } from "../cloud-billing/service";
import { createCostEntry, deleteCostEntry, listCostEntryPage, listRecentSnapshots, transferMonthlyCost, updateCostEntry } from "../service-entries";
import { upsertDailySnapshot } from "../service-snapshots";

const afterBudgetRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/db", async load => {
	const db = await load<typeof import("@/lib/db")>();
	if (process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1") return db;
	return { ...db, prisma: db.prisma.$extends({ query: { costBudget: {
		async findMany({ args, query }) { const rows = await query(args); await afterBudgetRead(); return rows; },
	} } }) };
});

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


	const replaceCsv = (id: string, csv: string) => prisma.cloudBillingAccount.update({ where: { id }, data: { config: { sampleCsv: csv } } });
	const ledger = (id: string) => prisma.costEntry.findMany({
		where: { teamId, sourceRef: { startsWith: id + ":" } }, orderBy: { amount: "asc" },
		select: { id: true, sourceRef: true, amount: true },
	});

	it.each([true, false])("preserves both charges on a partial natural-key replay (legacy=%s)", async legacy => {
		const data = ["2026-07-01,10,vm," + (legacy ? "first" : ""), "2026-07-01,20,vm,"];
		const billing = await account([header, ...data].join("\n"));
		await syncCloudBillingAccount(billing.id, month, session);
		const [first, second] = await ledger(billing.id);
		if (legacy) await prisma.costEntry.update({ where: { id: second!.id },
			data: { tags: [], sourceRef: billing.id + ":" + adapters.csvNaturalKeyPrefix("2026-07-01", "vm") + "2" } });
		await replaceCsv(billing.id, [header, data[1]].join("\n"));
		for (let i = 0; i < 2; i++) {
			await syncCloudBillingAccount(billing.id, month, session);
			expect((await ledger(billing.id)).map(row => [row.id, row.amount.toFixed(2)]))
				.toEqual([[first!.id, "10.00"], [second!.id, "20.00"]]);
		}
		if (!legacy) {
			await replaceCsv(billing.id, header + "\n2026-07-01,25,vm,");
			await expect(syncCloudBillingAccount(billing.id, month, session, true)).rejects.toMatchObject({ status: 409 });
		}
	});

	it("moves the legacy dual-column ID in place and refuses already booked aliases", async () => {
		const billing = await account(header + "\n2026-07-01,10,vm,B");
		await syncCloudBillingAccount(billing.id, month, session);
		const [previous] = await ledger(billing.id);
		await replaceCsv(billing.id, header + ",id\n2026-07-01,10,vm,A,B");
		await syncCloudBillingAccount(billing.id, month, session);
		expect(await ledger(billing.id)).toMatchObject([{ id: previous!.id, sourceRef: billing.id + ":csv:id:A" }]);
		await prisma.costEntry.create({ data: {
			teamId, sourceType: "cloud_billing", sourceRef: previous!.sourceRef, provider: "CSV · vm", category: "other", amount: 10, effectiveDate,
		} });
		await expect(syncCloudBillingAccount(billing.id, month, session, true)).rejects.toMatchObject({ status: 409 });
		expect(await ledger(billing.id)).toHaveLength(2);
	});

	it("keeps sub-cent allocations intact until a complete currency bucket is supplied", async () => {
		const a = "2026-07-01,0.005,vm,A", b = "2026-07-01,0.005,vm,B";
		const full = [header, a, b].join("\n");
		const billing = await account(full);
		await syncCloudBillingAccount(billing.id, month, session);
		const stored = await ledger(billing.id);
		await replaceCsv(billing.id, [header, b].join("\n"));
		await expect(syncCloudBillingAccount(billing.id, month, session)).rejects.toMatchObject({ status: 409 });
		expect(await ledger(billing.id)).toEqual(stored);
		await replaceCsv(billing.id, [header + ",currency", a + ",USD"].join("\n"));
		await expect(syncCloudBillingAccount(billing.id, month, session)).rejects.toMatchObject({ status: 409 });
		expect(await ledger(billing.id)).toEqual(stored);
		await replaceCsv(billing.id, full);
		await syncCloudBillingAccount(billing.id, month, session);
		expect((await ledger(billing.id)).map(row => row.amount.toFixed(2))).toEqual(["0.00", "0.01"]);
		await expect(updateCloudBillingAccount(billing.id, { config: {} }, session)).rejects.toThrow();
		expect((await prisma.cloudBillingAccount.findUniqueOrThrow({ where: { id: billing.id } })).config).toEqual({ sampleCsv: full });
	});

	it("serializes tag reconstruction, protects a referenced charge and transfers its current-month adjustment", async () => {
		const serverId = teamId + "-server";
		const source = await prisma.costEntry.create({ data: {
			teamId, sourceType: "server_monthly", sourceRef: serverId, category: "vps", provider: "vps", amount: 100, effectiveDate,
		} });
		const adjustment = await createCostEntry({ category: "vps", provider: "vps", amount: "-20", effectiveDate: "2026-07-02", adjustmentForId: source.id }, null, session);
		await expect(deleteCostEntry(source.id, session)).rejects.toMatchObject({ status: 409 });
		await Promise.all([updateCostEntry(adjustment.id, { category: "storage" }, session), updateCostEntry(adjustment.id, { provider: "Disk" }, session)]);
		expect((await prisma.costEntry.findUniqueOrThrow({ where: { id: adjustment.id } })).tags).toEqual(expect.arrayContaining(["category:storage", "provider:disk", "adjustment-for:" + source.id]));
		const dest = teamId + "-dest";
		await prisma.team.create({ data: { id: dest, name: dest, slug: dest } });
		try {
			await prisma.$transaction(tx => transferMonthlyCost(tx, serverId, month, dest));
			expect(await prisma.costEntry.count({ where: { id: { in: [source.id, adjustment.id] }, teamId: dest } })).toBe(2);
		} finally {
			await prisma.costEntry.deleteMany({ where: { teamId: dest } });
			await prisma.team.delete({ where: { id: dest } });
		}
	});

	it("reads the limit and spend from the same committed budget state", async () => {
		const budget = await prisma.costBudget.create({ data: { teamId, name: "Snapshot", category: "bandwidth", limitAmount: 100 } });
		const charge = { teamId, provider: "test", category: "bandwidth", effectiveDate };
		await prisma.costEntry.create({ data: { ...charge, amount: 50 } });
		afterBudgetRead.mockImplementationOnce(() => prisma.$transaction([
			prisma.costBudget.update({ where: { id: budget.id }, data: { limitAmount: 1000 } }),
			prisma.costEntry.create({ data: { ...charge, amount: 90 } }),
		]));
		const check = () => checkBudgetAlerts(effectiveDate, session);
		const during = await check();
		expect(during.budgets.find(row => row.id === budget.id)).toMatchObject({ usagePercent: 50, usageStatus: "within" });
		expect(during.triggered).toBe(0);
		const after = await check();
		expect(after.budgets.find(row => row.id === budget.id)).toMatchObject({ usagePercent: 14, usageStatus: "within" });
	});

	it("excludes an archived customer from manual all-customer budget checks", async () => {
		const archived = teamId + "-archived";
		await prisma.team.create({ data: { id: archived, name: archived, slug: archived, deletedAt: new Date() } });
		try {
			const budget = await prisma.costBudget.create({ data: { teamId: archived, name: "Archived", category: "vps", limitAmount: 1 } });
			await prisma.costEntry.create({ data: { teamId: archived, provider: "fixture", category: "vps", amount: 100, effectiveDate } });
			const result = await checkBudgetAlerts(effectiveDate, { userId: teamId, roles: ["admin"], currentTeamId: null });
			expect(result.budgets.find(row => row.id === budget.id)).toBeUndefined();
		} finally {
			await prisma.costEntry.deleteMany({ where: { teamId: archived } });
			await prisma.costBudget.deleteMany({ where: { teamId: archived } });
			await prisma.team.delete({ where: { id: archived } });
		}
	});

	it("paginates every detail on tied dates and reports the whole month's count", async () => {
		const data = Array.from({ length: 201 }, (_, i) => ({
			id: teamId + "-page-" + String(i).padStart(3, "0"), teamId, provider: "fixture", category: "other", amount: 1, effectiveDate: new Date("2025-05-01"),
		}));
		await prisma.costEntry.createMany({ data });
		const args = { session, month: "2025-05", limit: 200 };
		const first = await listCostEntryPage(args), second = await listCostEntryPage({ ...args, page: 2 });
		expect(first.total).toBe(201);
		expect(second).toMatchObject({ total: 201, page: 2, entries: [{ id: data[0]!.id }] });
		expect(new Set([...first.entries, ...second.entries].map(row => row.id)).size).toBe(201);
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
		// This database can also have platform administrators created by other suites.
		const fixtureUsers = new Set(ids);
		const where = { teamId, actionUrl, userId: { in: ids } };
		const inbox = () => prisma.notification.findMany({ where, select: { userId: true }, orderBy: { userId: "asc" } });
		try {
			const concurrent = await Promise.all([checkBudgetAlerts(effectiveDate, session), checkBudgetAlerts(effectiveDate, session)]);
			const announced = push.mock.calls.flatMap(([page]) => page);
			expect(concurrent.reduce((sum, result) => sum + result.notificationsSent, 0)).toBe(announced.length);
			expect(announced.map(row => row.userId).filter(id => fixtureUsers.has(id)).sort()).toEqual(ids.slice(2));
			expect((await inbox()).map(row => row.userId)).toEqual(ids.slice(1));
			await prisma.notification.deleteMany({ where });
			expect((await checkBudgetAlerts(effectiveDate, session)).duplicatesSkipped).toBeGreaterThanOrEqual(ids.length);
			expect(await inbox()).toEqual([]);
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
