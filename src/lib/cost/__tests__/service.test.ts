/**
 * TR-031 E01: Cost tracking — service unit tests.
 *
 * Uses vi.mock("@/lib/db") to swap in a minimal in-memory store that
 * mimics the subset of prisma.costEntry / prisma.costSnapshot methods
 * the service touches. Avoids the Prisma migration / SQLite dance.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CostEntryRow = {
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

function makePrismaMock() {
	return {
		costEntry: {
			create: vi.fn(async ({ data }: { data: Omit<CostEntryRow, "id" | "createdAt" | "updatedAt"> }) => {
				store.seq += 1;
				const row: CostEntryRow = {
					...data,
					id: `entry_${store.seq}`,
					createdAt: new Date("2026-06-01T00:00:00Z"),
					updatedAt: new Date("2026-06-01T00:00:00Z"),
				};
				store.entries.set(row.id, row);
				return row;
			}),
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
				return store.entries.get(where.id) ?? null;
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
				store.seq += 1;
				const row: CostEntryRow = {
					...create,
					id: `entry_${store.seq}`,
					createdAt: new Date("2026-06-01T00:00:00Z"),
					updatedAt: new Date("2026-06-01T00:00:00Z"),
				};
				store.entries.set(row.id, row);
				return row;
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
			update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<ServerRow> }) => {
				const current = store.servers.get(where.id);
				if (!current) throw new Error(`Server not found: ${where.id}`);
				const next = { ...current, ...data };
				store.servers.set(where.id, next);
				return next;
			}),
		},
		$transaction: vi.fn(async (arg: unknown) => {
			// Tests don't use $transaction directly; the service uses it only
			// for upsert which we've already mocked. Return identity passthrough.
			return typeof arg === "function" ? null : arg;
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
});

describe("syncServerMonthlyCosts", () => {
	it("upserts enabled server monthly costs idempotently", async () => {
		store.servers.set("srv_1", {
			id: "srv_1",
			name: "hk-prod",
			host: "203.0.113.10",
			enabled: true,
			costAutoSync: true,
			costMonthlyAmount: { toFixed: () => "88.50" },
			costCurrency: "CNY",
			costProvider: "Linode",
			costLastSyncedAt: null,
		});
		const first = await syncServerMonthlyCosts("2026-06");
		expect(first.synced).toBe(1);
		expect(first.entries[0]?.sourceType).toBe("server_monthly");
		expect(first.entries[0]?.sourceRef).toBe("srv_1");
		expect(first.entries[0]?.effectiveDate).toBe("2026-06-01");
		expect(first.entries[0]?.tags).toEqual([
			"source:server_monthly",
			"category:vps",
			"provider:linode",
			"server:srv_1",
		]);

		store.servers.set("srv_1", {
			...store.servers.get("srv_1")!,
			costMonthlyAmount: { toFixed: () => "99.00" },
		});
		const second = await syncServerMonthlyCosts("2026-06");
		expect(second.synced).toBe(1);
		expect(second.entries[0]?.id).toBe(first.entries[0]?.id);
		expect(second.entries[0]?.amount).toBe("99.00");
		expect(Array.from(store.entries.values()).filter((row) => row.sourceType === "server_monthly")).toHaveLength(1);
		expect(store.servers.get("srv_1")?.costLastSyncedAt).toBeInstanceOf(Date);
	});

	it("skips disabled or unconfigured servers", async () => {
		store.servers.set("disabled", {
			id: "disabled",
			name: "disabled",
			host: "203.0.113.11",
			enabled: false,
			costAutoSync: true,
			costMonthlyAmount: { toFixed: () => "10.00" },
			costCurrency: "CNY",
			costProvider: null,
			costLastSyncedAt: null,
		});
		store.servers.set("manual", {
			id: "manual",
			name: "manual",
			host: "203.0.113.12",
			enabled: true,
			costAutoSync: false,
			costMonthlyAmount: { toFixed: () => "10.00" },
			costCurrency: "CNY",
			costProvider: null,
			costLastSyncedAt: null,
		});
		const result = await syncServerMonthlyCosts("2026-06");
		expect(result.synced).toBe(0);
		expect(result.entries).toHaveLength(0);
	});
});

// Reference the mock so TypeScript doesn't complain about the unused
// module-level const; the actual mock instance is read by the service
// through `import { prisma } from "@/lib/db"`.
void prismaMock;
