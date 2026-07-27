import { Prisma } from "@prisma/client";
import type { RoleKey } from "@/lib/auth/rbac";
import type { CostCategory, CostCurrency, CostEntryRecord, CostSnapshotRecord } from "./types";
import { COST_CATEGORY_VALUES } from "./types";

export type TeamSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null };
export const DEFAULT_CURRENCY: CostCurrency = "CNY";
export const DEFAULT_LIST_LIMIT = 100;

export function isoDateOnly(d: Date): string {
	return d.toISOString().slice(0, 10);
}

function monthBoundsUtc(month: string): { start: Date; endExclusive: Date } {
	const parts = month.split("-");
	const y = Number(parts[0]);
	const m = Number(parts[1]);
	if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) throw new Error(`Invalid month: ${month}`);
	return { start: new Date(Date.UTC(y, m - 1, 1)), endExclusive: new Date(Date.UTC(y, m, 1)) };
}

export function startOfMonthUtc(month: string): Date { return monthBoundsUtc(month).start; }
export function endOfMonthUtc(month: string): Date { return monthBoundsUtc(month).endExclusive; }
export function lastDayIsoOfMonth(month: string): string {
	return isoDateOnly(new Date(monthBoundsUtc(month).endExclusive.getTime() - 1));
}

export function toRecord(entry: {
	id: string; category: string; provider: string; amount: Prisma.Decimal; currency: string;
	effectiveDate: Date; notes: string | null; createdById: string | null; sourceType: string | null;
	sourceRef: string | null; tags: string[]; teamId?: string | null; createdAt: Date; updatedAt: Date;
}): CostEntryRecord {
	return {
		id: entry.id, category: entry.category as CostCategory, provider: entry.provider,
		amount: entry.amount.toFixed(2), currency: (entry.currency as CostCurrency) ?? DEFAULT_CURRENCY,
		effectiveDate: isoDateOnly(entry.effectiveDate), notes: entry.notes, createdById: entry.createdById,
		sourceType: entry.sourceType, sourceRef: entry.sourceRef, tags: entry.tags, teamId: entry.teamId ?? null,
		createdAt: entry.createdAt.toISOString(), updatedAt: entry.updatedAt.toISOString(),
	};
}

function tagValue(value: string): string {
	return value.trim().toLocaleLowerCase().replace(/\s+/gu, "-").slice(0, 128);
}

export function automaticTags(sourceType: string, category: CostCategory, provider: string, sourceRef?: string | null): string[] {
	return [`source:${tagValue(sourceType)}`, `category:${category}`, `provider:${tagValue(provider)}`, ...(sourceRef ? [`server:${tagValue(sourceRef)}`] : [])];
}

export function toSnapshot(snap: { id: string; snapshotDate: Date; totalAmount: Prisma.Decimal; byCategory: Prisma.JsonValue; entryCount: number; createdAt: Date }): CostSnapshotRecord {
	const by = (snap.byCategory ?? {}) as Record<string, unknown>;
	const byCategory = Object.fromEntries(COST_CATEGORY_VALUES.map((c) => [c, typeof by[c] === "string" ? by[c] : "0.00"])) as Record<CostCategory, string>;
	return { id: snap.id, snapshotDate: isoDateOnly(snap.snapshotDate), totalAmount: snap.totalAmount.toFixed(2), byCategory, entryCount: snap.entryCount, createdAt: snap.createdAt.toISOString() };
}

export function emptyByCategory(): Record<CostCategory, string> {
	return Object.fromEntries(COST_CATEGORY_VALUES.map((c) => [c, "0.00"])) as Record<CostCategory, string>;
}

export function addDecimal(target: Record<CostCategory, string>, cat: CostCategory, amount: string) {
	const cur = Number(target[cat] ?? "0");
	const inc = Number(amount);
	target[cat] = ((Number.isFinite(cur) ? cur : 0) + (Number.isFinite(inc) ? inc : 0)).toFixed(2);
}
