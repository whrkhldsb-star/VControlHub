/**
 * TR-031 E01: Cost tracking — service unit tests.
 *
 * Uses vi.mock("@/lib/db") to swap in a minimal in-memory store that
 * mimics the subset of prisma.costEntry / prisma.costSnapshot methods
 * the service touches. Avoids the Prisma migration / SQLite dance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CostEntryRow = {
	teamId?: string | null;
	id: string;
	category: string;
	provider: string;
	amount: string; // store as string to mirror Decimal precision
	currency: string;
	effectiveDate: Date;
	notes: string | null;
	createdById: string | null;
	sourceType: string | null;
	sourceRef: string | null;
	tags: string[];
	createdAt: Date;
	updatedAt: Date;
};

type CostSnapshotRow = {
	id: string;
	snapshotDate: Date;
	totalAmount: string;
	byCategory: Record<string, string>;
	entryCount: number;
	createdAt: Date;
};

type ServerRow = {
	teamId?: string | null;
	createdAt: Date;
	updatedAt: Date;
	id: string;
	name: string;
	host: string;
	enabled: boolean;
	costAutoSync: boolean;
	costMonthlyAmount: { toFixed: (digits?: number) => string } | null;
	costCurrency: string;
	costProvider: string | null;
	costLastSyncedAt: Date | null;
};

const store = {
	entries: new Map<string, CostEntryRow>(),
	snapshots: new Map<string, CostSnapshotRow>(), // key = snapshotDate.toISOString()
	servers: new Map<string, ServerRow>(),
	seq: 0,
};

function resetStore() {
	store.entries.clear();
	store.snapshots.clear();
	store.servers.clear();
	store.seq = 0;
}

type NewCostEntry = Omit<CostEntryRow, "id" | "createdAt" | "updatedAt">;

function insertCostEntry(data: NewCostEntry) {
	const row = { ...data, id: `entry_${++store.seq}`, createdAt: new Date(), updatedAt: new Date() };
	store.entries.set(row.id, row);
	return row;
}

function makePrismaMock() {
	return {
		costEntry: {
			create: vi.fn(async ({ data }: { data: NewCostEntry }) => insertCostEntry(data)),
			createMany: vi.fn(async ({ data }: { data: NewCostEntry; skipDuplicates: true }) => {
				const duplicate = [...store.entries.values()].some(row => row.sourceType === data.sourceType
					&& row.sourceRef === data.sourceRef && +row.effectiveDate === +data.effectiveDate);
				if (duplicate) return { count: 0 };
				insertCostEntry(data);
				return { count: 1 };
			}),
			findUnique: vi.fn(async ({ where }: { where: { id?: string; sourceType_sourceRef_effectiveDate?: { sourceType: string; sourceRef: string; effectiveDate: Date } } }) => {
				const key = where.sourceType_sourceRef_effectiveDate;
				if (key) return [...store.entries.values()].find(row => row.sourceType === key.sourceType && row.sourceRef === key.sourceRef && +row.effectiveDate === +key.effectiveDate) ?? null;
				return store.entries.get(where.id!) ?? null;
			}),
			findMany: vi.fn(
				async ({
					where,
					orderBy,
					take,
				}: {
					where?: { category?: string; effectiveDate?: { gte?: Date; lt?: Date } };
					orderBy?: { effectiveDate?: "asc" | "desc" };
					take?: number;
				}) => {
					let rows = Array.from(store.entries.values());
					if (where?.category) rows = rows.filter((r) => r.category === where.category);
					if (where?.effectiveDate?.gte) {
						const gte = where.effectiveDate.gte.getTime();
						rows = rows.filter((r) => r.effectiveDate.getTime() >= gte);
					}
					if (where?.effectiveDate?.lt) {
						const lt = where.effectiveDate.lt.getTime();
						rows = rows.filter((r) => r.effectiveDate.getTime() < lt);
					}
					if (orderBy?.effectiveDate === "desc") {
						rows.sort((a, b) => b.effectiveDate.getTime() - a.effectiveDate.getTime());
					}
					if (take !== undefined) rows = rows.slice(0, take);
					return rows;
				},
			),
			groupBy: vi.fn(
				async ({
					by,
					where,
					orderBy,
				}: {
					by: Array<"category" | "effectiveDate">;
					where?: { currency?: string; effectiveDate?: { gte?: Date; lt?: Date } };
					orderBy?: { effectiveDate?: "asc" | "desc" };
				}) => {
					let rows = Array.from(store.entries.values());
					if (where?.currency) rows = rows.filter((row) => row.currency === where.currency);
					if (where?.effectiveDate?.gte) rows = rows.filter((row) => row.effectiveDate >= where.effectiveDate!.gte!);
					if (where?.effectiveDate?.lt) rows = rows.filter((row) => row.effectiveDate < where.effectiveDate!.lt!);
					const groups = new Map<string, { category: string; effectiveDate?: Date; amount: number; count: number }>();
					for (const row of rows) {
						const key = by.includes("effectiveDate")
							? row.effectiveDate.toISOString() + ":" + row.category
							: row.category;
						const group = groups.get(key) ?? {
							category: row.category,
							...(by.includes("effectiveDate") ? { effectiveDate: row.effectiveDate } : {}),
							amount: 0,
							count: 0,
						};
						group.amount += Number(row.amount);
						group.count += 1;
						groups.set(key, group);
					}
					const result = Array.from(groups.values()).map((group) => ({
						category: group.category,
						...(group.effectiveDate ? { effectiveDate: group.effectiveDate } : {}),
						_sum: { amount: { toString: () => group.amount.toFixed(2) } },
						_count: { _all: group.count },
					}));
					if (orderBy?.effectiveDate === "desc") {
						result.sort((a, b) => (b.effectiveDate?.getTime() ?? 0) - (a.effectiveDate?.getTime() ?? 0));
					}
					return result;
				},
			),
			update: vi.fn(
				async ({ where, data }: { where: { id: string }; data: Partial<CostEntryRow> }) => {
					const cur = store.entries.get(where.id);
					if (!cur) throw new Error(`CostEntry not found: ${where.id}`);
					const next: CostEntryRow = {
						...cur,
						...data,
						updatedAt: new Date("2026-06-02T00:00:00Z"),
					};
					store.entries.set(where.id, next);
					return next;
				},
			),
			delete: vi.fn(async ({ where }: { where: { id: string } }) => {
				const cur = store.entries.get(where.id);
				if (!cur) throw new Error(`CostEntry not found: ${where.id}`);
				store.entries.delete(where.id);
				return cur;
			}),
			upsert: vi.fn(async ({ where, create, update }: { where: { sourceType_sourceRef_effectiveDate: { sourceType: string; sourceRef: string; effectiveDate: Date } }; create: Omit<CostEntryRow, "id" | "createdAt" | "updatedAt">; update: Partial<CostEntryRow> }) => {
				const key = `${where.sourceType_sourceRef_effectiveDate.sourceType}:${where.sourceType_sourceRef_effectiveDate.sourceRef}:${where.sourceType_sourceRef_effectiveDate.effectiveDate.toISOString()}`;
				const existing = Array.from(store.entries.values()).find((row) => `${row.sourceType}:${row.sourceRef}:${row.effectiveDate.toISOString()}` === key);
				if (existing) {
					const next = { ...existing, ...update, updatedAt: new Date("2026-06-03T00:00:00Z") } as CostEntryRow;
					store.entries.set(existing.id, next);
					return next;
				}
				return insertCostEntry(create);
			}),
		},
		costSnapshot: {
			findMany: vi.fn(
				async ({
					orderBy,
					take,
				}: {
					orderBy?: { snapshotDate?: "asc" | "desc" };
					take?: number;
				}) => {
					let rows = Array.from(store.snapshots.values());
					if (orderBy?.snapshotDate === "desc") {
						rows.sort((a, b) => b.snapshotDate.getTime() - a.snapshotDate.getTime());
					}
					if (take !== undefined) rows = rows.slice(0, take);
					return rows;
				},
			),
			upsert: vi.fn(
				async ({
					where,
					create,
					update,
				}: {
					where: { snapshotDate: Date };
					create: Omit<CostSnapshotRow, "id" | "createdAt">;
					update: Partial<CostSnapshotRow>;
				}) => {
					const key = where.snapshotDate.toISOString();
					const existing = store.snapshots.get(key);
					if (existing) {
						const next = { ...existing, ...update };
						store.snapshots.set(key, next);
						return next;
					}
					store.seq += 1;
					const row: CostSnapshotRow = {
						id: `snap_${store.seq}`,
						createdAt: new Date("2026-06-01T00:00:00Z"),
						...create,
					};
					store.snapshots.set(key, row);
					return row;
				},
			),
		},
		server: {
			findMany: vi.fn(async ({ where }: { where?: { enabled?: boolean; costAutoSync?: boolean; costMonthlyAmount?: { not: null } } }) => {
				let rows = Array.from(store.servers.values());
				if (where?.enabled !== undefined) rows = rows.filter((row) => row.enabled === where.enabled);
				if (where?.costAutoSync !== undefined) rows = rows.filter((row) => row.costAutoSync === where.costAutoSync);
				if (where?.costMonthlyAmount?.not === null) rows = rows.filter((row) => row.costMonthlyAmount !== null);
				return rows.slice(0, 1000);
			}),
			updateMany: vi.fn(async ({ where, data }: { where: { id: string; teamId: string | null; updatedAt?: Date }; data: Partial<ServerRow> }) => {
				const current = store.servers.get(where.id);
				if (!current || (current.teamId ?? null) !== where.teamId) return { count: 0 };
				if (where.updatedAt && +current.updatedAt !== +where.updatedAt) return { count: 0 };
				const next = { ...current, updatedAt: new Date(), ...data };
				store.servers.set(where.id, next);
				return { count: 1 };
			}),
		},
		$transaction: vi.fn(async (arg: unknown) => {
			return typeof arg === "function" ? arg(prisma) : arg;
		}),
	};
}

vi.mock("@/lib/db", () => ({
	prisma: makePrismaMock(),
}));

import {
	createCostEntry,
	updateCostEntry,
	deleteCostEntry,
	getCostEntry,
	listCostEntries,
	summarizeMonth,
	listRecentSnapshots,
	syncServerMonthlyCosts,
	upsertDailySnapshot,
} from "../service";
import { prisma } from "@/lib/db";

const prismaMock = prisma as unknown as ReturnType<typeof makePrismaMock>;

beforeEach(() => {
	resetStore();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("createCostEntry", () => {
	it("normalizes defaults and persists", async () => {
		const rec = await createCostEntry({
			category: "vps",
			provider: "阿里云",
			amount: "12.50",
			effectiveDate: "2026-06-15",
		});
		expect(rec.id).toMatch(/^entry_/);
		expect(rec.currency).toBe("CNY");
		expect(rec.amount).toBe("12.50");
		expect(rec.effectiveDate).toBe("2026-06-15");
		expect(rec.createdById).toBeNull();
		expect(rec.tags).toEqual(["source:manual", "category:vps", "provider:阿里云"]);
	});

	it("stores optional notes + custom currency", async () => {
		const rec = await createCostEntry({
			category: "bandwidth",
			provider: "Cloudflare",
			amount: "9.99",
			currency: "USD",
			effectiveDate: "2026-06-01",
			notes: "Pro plan",
		});
		expect(rec.currency).toBe("USD");
		expect(rec.notes).toBe("Pro plan");
	});

	it("rejects invalid input via zod (negative amount)", async () => {
		await expect(
			createCostEntry({
				category: "vps",
				provider: "x",
				amount: "-1.00",
				effectiveDate: "2026-06-15",
			}),
		).rejects.toThrow();
	});

	it("rejects bad date format", async () => {
		await expect(
			createCostEntry({
				category: "vps",
				provider: "x",
				amount: "1.00",
				effectiveDate: "20260615",
			}),
		).rejects.toThrow();
	});
});

describe("updateCostEntry", () => {
	it("patches a subset of fields", async () => {
		const created = await createCostEntry({
			category: "vps",
			provider: "x",
			amount: "10.00",
			effectiveDate: "2026-06-15",
		});
		const updated = await updateCostEntry(created.id, { amount: "20.00" });
		expect(updated.amount).toBe("20.00");
		expect(updated.provider).toBe("x");
	});

	it("rejects empty patches", async () => {
		await expect(updateCostEntry("entry_1", {})).rejects.toThrow();
	});
});

describe("deleteCostEntry + getCostEntry", () => {
	it("round-trips", async () => {
		const created = await createCostEntry({
			category: "storage",
			provider: "B2",
			amount: "3.50",
			effectiveDate: "2026-06-15",
		});
		expect(await getCostEntry(created.id)).not.toBeNull();
		await deleteCostEntry(created.id);
		expect(await getCostEntry(created.id)).toBeNull();
	});
});

describe("listCostEntries", () => {
	it("filters by month", async () => {
		await createCostEntry({
			category: "vps",
			provider: "A",
			amount: "1",
			effectiveDate: "2026-05-30",
		});
		await createCostEntry({
			category: "vps",
			provider: "A",
			amount: "2",
			effectiveDate: "2026-06-15",
		});
		await createCostEntry({
			category: "vps",
			provider: "A",
			amount: "3",
			effectiveDate: "2026-07-01",
		});
		const june = await listCostEntries({ month: "2026-06" });
		expect(june).toHaveLength(1);
		expect(june[0]?.amount).toBe("2.00");
	});

	it("filters by category", async () => {
		await createCostEntry({
			category: "vps",
			provider: "A",
			amount: "1",
			effectiveDate: "2026-06-01",
		});
		await createCostEntry({
			category: "storage",
			provider: "B",
			amount: "2",
			effectiveDate: "2026-06-02",
		});
		const vps = await listCostEntries({ category: "vps" });
		expect(vps).toHaveLength(1);
		expect(vps[0]?.category).toBe("vps");
	});
});

describe("summarizeMonth", () => {
	it("aggregates by category in requested currency only", async () => {
		await createCostEntry({
			category: "vps",
			provider: "A",
			amount: "100.00",
			currency: "CNY",
			effectiveDate: "2026-06-05",
		});
		await createCostEntry({
			category: "vps",
			provider: "B",
			amount: "50.00",
			currency: "CNY",
			effectiveDate: "2026-06-10",
		});
		await createCostEntry({
			category: "bandwidth",
			provider: "C",
			amount: "20.00",
			currency: "CNY",
			effectiveDate: "2026-06-20",
		});
		// USD entry must not be summed into CNY total.
		await createCostEntry({
			category: "vps",
			provider: "D",
			amount: "9.99",
			currency: "USD",
			effectiveDate: "2026-06-25",
		});
		const summary = await summarizeMonth("2026-06", "CNY");
		expect(summary.totalAmount).toBe("170.00");
		expect(summary.byCategory.vps).toBe("150.00");
		expect(summary.byCategory.bandwidth).toBe("20.00");
		expect(summary.byCategory.storage).toBe("0.00");
		expect(summary.entryCount).toBe(3);
		expect(summary.rangeStart).toBe("2026-06-01");
		expect(summary.rangeEnd).toBe("2026-06-30");
	});

	it("rejects malformed month", async () => {
		await expect(summarizeMonth("2026-13")).rejects.toThrow();
		await expect(summarizeMonth("2026/06")).rejects.toThrow();
	});
});

describe("snapshot writer + reader", () => {
	it("upsertDailySnapshot is idempotent on the same date", async () => {
		const day = new Date("2026-06-15T00:00:00Z");
		await upsertDailySnapshot({
			snapshotDate: day,
			totalAmount: "100.00",
			byCategory: { vps: "70.00", bandwidth: "20.00", storage: "10.00", other: "0.00" },
			entryCount: 5,
		});
		const updated = await upsertDailySnapshot({
			snapshotDate: day,
			totalAmount: "150.00",
			byCategory: { vps: "100.00", bandwidth: "30.00", storage: "20.00", other: "0.00" },
			entryCount: 6,
		});
		expect(updated.entryCount).toBe(6);
		expect(updated.totalAmount).toBe("150.00");
	});

	it("listRecentSnapshots returns most-recent-first", async () => {
		await upsertDailySnapshot({
			snapshotDate: new Date("2026-06-10T00:00:00Z"),
			totalAmount: "10",
			byCategory: { vps: "10", bandwidth: "0", storage: "0", other: "0" },
			entryCount: 1,
		});
		await upsertDailySnapshot({
			snapshotDate: new Date("2026-06-15T00:00:00Z"),
			totalAmount: "20",
			byCategory: { vps: "20", bandwidth: "0", storage: "0", other: "0" },
			entryCount: 1,
		});
		const recent = await listRecentSnapshots(10);
		expect(recent.map((r) => r.snapshotDate)).toEqual(["2026-06-15", "2026-06-10"]);
	});

	it("aggregates team snapshots in the database by day and category", async () => {
		const today = new Date().toISOString().slice(0, 10);
		await createCostEntry({ category: "vps", provider: "A", amount: "10", currency: "CNY", effectiveDate: today });
		await createCostEntry({ category: "storage", provider: "B", amount: "5", currency: "CNY", effectiveDate: today });
		await createCostEntry({ category: "vps", provider: "C", amount: "99", currency: "USD", effectiveDate: today });

		const recent = await listRecentSnapshots(
			30,
			{ userId: "user-1", roles: ["operator"], currentTeamId: "team-1" },
			"CNY",
		);

		expect(recent).toHaveLength(1);
		expect(recent[0]).toMatchObject({
			snapshotDate: today,
			totalAmount: "15.00",
			entryCount: 2,
			byCategory: { vps: "10.00", storage: "5.00" },
		});
		expect(prismaMock.costEntry.groupBy).toHaveBeenCalledWith(
			expect.objectContaining({
				by: ["effectiveDate", "category"],
				where: expect.objectContaining({ currency: "CNY" }),
			}),
		);
	});
});

describe("syncServerMonthlyCosts", () => {
	/**
	 * The sync returns counts only, so correctness is asserted against the rows it
	 * wrote rather than against its return value.
	 */
	function syncedRows() {
		return Array.from(store.entries.values()).filter((row) => row.sourceType === "server_monthly");
	}

	function server(overrides: Partial<ServerRow> = {}): ServerRow {
		return {
			id: "srv_1", name: "hk-prod", host: "203.0.113.10", teamId: "A",
			enabled: true, costAutoSync: true, costMonthlyAmount: { toFixed: () => "88.50" },
			costCurrency: "CNY", costProvider: "Linode", costLastSyncedAt: null,
			createdAt: new Date("2026-03-15T12:00:00Z"), updatedAt: new Date("2026-03-15T12:00:00Z"),
			...overrides,
		};
	}

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
	});

	it("files the monthly fee under the application-time month, as budgets do", async () => {
		store.servers.set("srv_1", server());
		// 2026-11-01 00:30 in Asia/Shanghai; UTC is still in October.
		vi.setSystemTime(new Date("2026-10-31T16:30:00Z"));
		expect((await syncServerMonthlyCosts()).month).toBe("2026-11");
		expect(syncedRows()[0]?.effectiveDate.toISOString()).toBe("2026-11-01T00:00:00.000Z");
	});

	it("upserts enabled server monthly costs idempotently", async () => {
		store.servers.set("srv_1", server());
		const first = await syncServerMonthlyCosts("2026-06");
		expect(first.synced).toBe(1);
		const created = syncedRows()[0];
		expect(created?.sourceRef).toBe("srv_1");
		// Shown in the cost entries list: it was a fixed English sentence.
		expect(created?.notes).toBe("自动采集：hk-prod（203.0.113.10）2026-06 VPS 月费");
		expect(created?.effectiveDate.toISOString()).toBe("2026-06-01T00:00:00.000Z");
		expect(created?.tags).toEqual([
			"source:server_monthly",
			"category:vps",
			"provider:linode",
			"server:srv_1",
		]);

		store.servers.set("srv_1", {
			...store.servers.get("srv_1")!,
			costMonthlyAmount: { toFixed: () => "99.00" },
			teamId: "B",
		});
		const { withApiCopyLocale } = await import("@/lib/i18n/api-copy");
		const second = await withApiCopyLocale("en", () => syncServerMonthlyCosts("2026-06"));
		expect(second.synced).toBe(1);
		const updated = syncedRows()[0];
		expect(updated?.id).toBe(created?.id);
		expect(updated?.teamId).toBe("B");
		expect(updated?.notes).toBe("Auto-collected: hk-prod (203.0.113.10) 2026-06 VPS monthly fee");
		expect(Number(String(updated?.amount))).toBe(99);
		expect(syncedRows()).toHaveLength(1);
		expect(store.servers.get("srv_1")?.costLastSyncedAt).toBeInstanceOf(Date);
	});

	it("skips a missing prior-month fee after a transfer, but bills the new owner this month", async () => {
		const original = server();
		// The transfer was on June 1 in the billing timezone, still May 31 UTC.
		const transferred = { ...original, teamId: "B", updatedAt: new Date("2026-05-31T16:00:00Z") };
		store.servers.set(original.id, transferred);
		expect(await syncServerMonthlyCosts("2026-05")).toMatchObject({
			synced: 0, skipped: 1, skippedDetails: [{ serverId: original.id, reason: "unverified_history" }],
		});
		expect(syncedRows()).toHaveLength(0);
		expect((await syncServerMonthlyCosts()).synced).toBe(1);
		expect(syncedRows()).toMatchObject([{ teamId: "B", effectiveDate: new Date("2026-06-01") }]);
	});

	it("preserves a recorded month's rate, currency and owner after repricing or a transfer", async () => {
		const original = server();
		store.servers.set(original.id, original);
		await syncServerMonthlyCosts();
		const recorded = syncedRows()[0]!;
		vi.setSystemTime(new Date("2026-07-05T12:00:00Z"));
		const repriced = { ...original, costMonthlyAmount: { toFixed: () => "160.00" }, costCurrency: "USD", updatedAt: new Date() };
		store.servers.set(original.id, repriced);
		expect(await syncServerMonthlyCosts("2026-06")).toMatchObject({
			synced: 0, skipped: 1, skippedDetails: [{ serverId: original.id, reason: "already_recorded" }],
		});
		expect(syncedRows()[0]).toEqual(recorded);
		store.servers.set(original.id, { ...repriced, teamId: "B" });
		expect((await syncServerMonthlyCosts("2026-06")).skippedDetails[0]?.reason).toBe("ownership_changed");
		expect(syncedRows()[0]).toEqual(recorded);
		expect(prismaMock.server.updateMany).toHaveBeenCalledTimes(1);
	});

	it("backfills missing months from an unchanged record only after the server existed", async () => {
		const original = server();
		store.servers.set(original.id, original);
		expect((await syncServerMonthlyCosts("2026-02")).skipped).toBe(1);
		expect((await syncServerMonthlyCosts("2026-04")).synced).toBe(1);
		expect((await syncServerMonthlyCosts("2026-05")).synced).toBe(1);
		expect(syncedRows().map(row => [row.effectiveDate.toISOString().slice(0, 7), row.teamId, String(row.amount)]))
			.toEqual([["2026-04", "A", "88.5"], ["2026-05", "A", "88.5"]]);
	});

	it("skips a historical insert if the server version changed after the fleet was read", async () => {
		const original = server();
		prismaMock.server.findMany.mockResolvedValueOnce([original]);
		store.servers.set(original.id, { ...original, updatedAt: new Date() });
		expect((await syncServerMonthlyCosts("2026-05")).skipped).toBe(1);
		expect(syncedRows()).toHaveLength(0);
	});

	it("skips disabled or unconfigured servers", async () => {
		store.servers.set("disabled", server({ id: "disabled", enabled: false }));
		store.servers.set("manual", server({ id: "manual", costAutoSync: false }));
		const result = await syncServerMonthlyCosts("2026-06");
		expect(result.synced).toBe(0);
		expect(syncedRows()).toHaveLength(0);
	});
});

// Reference the mock so TypeScript doesn't complain about the unused
// module-level const; the actual mock instance is read by the service
// through `import { prisma } from "@/lib/db"`.
void prismaMock;
