import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CostCategory, CostSnapshotRecord } from "./types";
import { toSnapshot } from "./service-internals";
import { toJsonValue } from "@/lib/db/json";

export interface SnapshotWriteInput { snapshotDate: Date; totalAmount: string; byCategory: Record<CostCategory, string>; entryCount: number; }
export async function upsertDailySnapshot(input: SnapshotWriteInput): Promise<CostSnapshotRecord> {
	const total = new Prisma.Decimal(input.totalAmount).toDecimalPlaces(2);
	if (!total.isFinite()) throw new RangeError("Invalid cost snapshot total");
	// Decimal(14,2) is shared with older releases. Preserve the exact amount
	// in the existing JSON column whenever the indexed-day row exceeds it.
	const bounded = total.clamp("-999999999999.99", "999999999999.99");
	const byCategory = total.equals(bounded) ? input.byCategory : { ...input.byCategory, exactTotalAmount: total.toFixed(2) };
	const data = { totalAmount: bounded, byCategory: toJsonValue(byCategory), entryCount: input.entryCount };
	const snap = await prisma.costSnapshot.upsert({ where: { snapshotDate: input.snapshotDate }, create: { snapshotDate: input.snapshotDate, ...data }, update: data });
	return toSnapshot(snap);
}
