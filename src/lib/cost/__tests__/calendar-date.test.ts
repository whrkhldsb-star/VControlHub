import { describe, expect, it } from "vitest";
import { isCalendarDate } from "../calendar-date";
import { createCostEntrySchema } from "../schema";
import { isValidDate } from "@/app/cost-summary/cost-page-shared";

describe("calendar dates", () => {
	it("accepts real days and refuses ones Date would roll into the next month", () => {
		expect(["2026-02-28", "2028-02-29", "2026-12-31", "2026-01-01"].every(isCalendarDate)).toBe(true);
		expect(["2026-02-31", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-10", "2026-1-01", "26-01-01"].some(isCalendarDate)).toBe(false);
	});

	it("is what manual entries and the cost form validate with", () => {
		const entry = { category: "vps", provider: "x", amount: "123.45" };
		expect(createCostEntrySchema.safeParse({ ...entry, effectiveDate: "2026-02-31" }).success).toBe(false);
		expect(createCostEntrySchema.safeParse({ ...entry, effectiveDate: "2026-02-28" }).success).toBe(true);
		expect(isValidDate("2026-02-31")).toBe(false);
	});
});
