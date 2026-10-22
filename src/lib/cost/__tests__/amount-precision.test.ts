import { describe, expect, it } from "vitest";

import { createServerSchema } from "@/lib/server/schema";
import { createCostBudgetSchema, createCostEntrySchema } from "../schema";

/**
 * Amounts are stored as Decimal(12,2): 9,999,999,999.99 at most. Validation
 * that accepted up to 1e12 let a value through that the database refused.
 */
describe("cost amount bounds match the Decimal(12,2) columns", () => {
	const entry = { category: "vps", provider: "Linode", effectiveDate: "2026-10-01" } as const;
	const budget = { category: "vps", name: "Fleet" } as const;

	it("accepts the largest storable amount and refuses the next cent", () => {
		expect(createCostEntrySchema.safeParse({ ...entry, amount: "9999999999.99" }).success).toBe(true);
		expect(createCostEntrySchema.safeParse({ ...entry, amount: "10000000000.00" }).success).toBe(false);
		expect(createCostBudgetSchema.safeParse({ ...budget, limitAmount: "9999999999.99" }).success).toBe(true);
		expect(createCostBudgetSchema.safeParse({ ...budget, limitAmount: "10000000000" }).success).toBe(false);
	});

	it("bounds a server's monthly fee the same way", () => {
		const server = { name: "node-1", host: "203.0.113.5", username: "root", connectionType: "PASSWORD", password: "pw" };
		const fee = (costMonthlyAmount: string) => createServerSchema.safeParse({ ...server, costMonthlyAmount }).success;
		expect(fee("9999999999.99")).toBe(true);
		expect(fee("10000000000")).toBe(false);
	});
});
