import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { billingInputFromForm, normalizeServerBilling } from "../billing";
import { billingFormValues, toServerBillingDto } from "../billing-form";

const GIB = 1024 ** 3;

describe("server billing", () => {
	it("ends a rental at the last second of the chosen day in the platform time zone", () => {
		const values = normalizeServerBilling({ expiresOn: "2026-11-09", trafficQuotaGb: "", trafficQuotaMode: "sum" });
		// Asia/Shanghai is UTC+8: 23:59:59 local is 15:59:59 UTC.
		expect(values.expiresAt?.toISOString()).toBe("2026-11-09T15:59:59.000Z");
		expect(values.trafficQuotaBytes).toBeNull();
	});

	it("stores a quota in bytes and its counting mode, unlimited when empty", () => {
		expect(normalizeServerBilling({ expiresOn: "", trafficQuotaGb: "1.5", trafficQuotaMode: "out" })).toEqual({
			expiresAt: null,
			trafficQuotaBytes: BigInt(1.5 * GIB),
			trafficQuotaMode: "out",
		});
		expect(normalizeServerBilling({ expiresOn: "", trafficQuotaGb: " ", trafficQuotaMode: "bogus" })).toMatchObject({ trafficQuotaBytes: null, trafficQuotaMode: "sum" });
	});

	it("refuses dates and quotas it cannot store", () => {
		for (const expiresOn of ["2026-13-01", "2026-02-30", "tomorrow", "2026/11/09"]) {
			expect(() => normalizeServerBilling({ expiresOn, trafficQuotaGb: "", trafficQuotaMode: "sum" })).toThrow();
		}
		for (const trafficQuotaGb of ["0", "-1", "abc", "1.2345", "2000000"]) {
			expect(() => normalizeServerBilling({ expiresOn: "", trafficQuotaGb, trafficQuotaMode: "sum" })).toThrow();
		}
	});

	it("reads the form only when it carries the billing fields", () => {
		const without = new FormData();
		without.set("name", "x");
		expect(billingInputFromForm(without)).toBeNull();
		const form = new FormData();
		form.set("expiresOn", "2026-11-09");
		form.set("trafficQuotaGb", "1024");
		form.set("trafficQuotaMode", "max");
		expect(billingInputFromForm(form)).toEqual({ expiresOn: "2026-11-09", trafficQuotaGb: "1024", trafficQuotaMode: "max" });
	});

	it("round-trips stored values back into the form", () => {
		const dto = toServerBillingDto({ expiresAt: new Date("2026-11-09T15:59:59.000Z"), trafficQuotaBytes: BigInt(1024 * GIB), trafficQuotaMode: "in" });
		expect(dto).toEqual({ expiresAt: "2026-11-09T15:59:59.000Z", trafficQuotaBytes: 1024 * GIB, trafficQuotaMode: "in" });
		expect(billingFormValues(dto)).toEqual({ expiresOn: "2026-11-09", trafficQuotaGb: "1024", trafficQuotaMode: "in" });
		expect(billingFormValues(toServerBillingDto({ expiresAt: null, trafficQuotaBytes: null, trafficQuotaMode: null }))).toEqual({ expiresOn: "", trafficQuotaGb: "", trafficQuotaMode: "sum" });
	});
});
