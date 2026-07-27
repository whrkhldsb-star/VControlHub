import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { CostCategory, CostSnapshotRecord } from "./types";
import { toSnapshot } from "./service-internals";

export interface SnapshotWriteInput { snapshotDate: Date; totalAmount: string; byCategory: Record<CostCategory, string>; entryCount: number; }
export async function upsertDailySnapshot(input: SnapshotWriteInput): Promise<CostSnapshotRecord> {
	const snap = await prisma.costSnapshot.upsert({ where: { snapshotDate: input.snapshotDate }, create: { snapshotDate: input.snapshotDate, totalAmount: new Prisma.Decimal(input.totalAmount), byCategory: input.byCategory as unknown as Prisma.InputJsonValue, entryCount: input.entryCount }, update: { totalAmount: new Prisma.Decimal(input.totalAmount), byCategory: input.byCategory as unknown as Prisma.InputJsonValue, entryCount: input.entryCount } });
	return toSnapshot(snap);
}
