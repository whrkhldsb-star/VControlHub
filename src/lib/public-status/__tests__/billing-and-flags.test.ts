import { describe, expect, it } from "vitest";

import { daysUntil, expiryTone, quotaCountedBytes, quotaUsagePercent, usageTone } from "../billing";
import { countryFlag, countryName, normalizeCountryCode } from "../region-flag";

describe("traffic quota", () => {
	it("counts the billed direction", () => {
		expect(quotaCountedBytes("sum", 30, 10)).toBe(40);
		expect(quotaCountedBytes("max", 30, 10)).toBe(30);
		expect(quotaCountedBytes("in", 30, 10)).toBe(30);
		expect(quotaCountedBytes("out", 30, 10)).toBe(10);
		expect(quotaCountedBytes("sum", null, 10)).toBeNull();
		expect(quotaCountedBytes("out", null, 10)).toBe(10);
	});

	it("reports usage of the limit, over 100 when exceeded, and nothing without a limit", () => {
		expect(quotaUsagePercent("sum", 50, 50, 200)).toBe(50);
		expect(quotaUsagePercent("sum", 150, 100, 200)).toBe(125);
		expect(quotaUsagePercent("sum", 50, 50, null)).toBeNull();
		expect(quotaUsagePercent("sum", 50, 50, 0)).toBeNull();
	});
});

describe("expiry", () => {
	const now = Date.parse("2026-10-17T00:00:00Z");
	it("counts whole days left and colours them", () => {
		expect(daysUntil("2026-10-24T00:00:00Z", now)).toBe(7);
		expect(daysUntil("2026-10-24T00:00:01Z", now)).toBe(8);
		expect(daysUntil("2026-10-16T00:00:00Z", now)).toBe(-1);
		expect(expiryTone(-1)).toBe("danger");
		expect(expiryTone(7)).toBe("danger");
		expect(expiryTone(15)).toBe("warning");
		expect(expiryTone(16)).toBe("success");
		expect(expiryTone(5000)).toBe("neutral");
	});

	it("grades usage like Komari: green, amber from 60, red from 80", () => {
		expect(usageTone(59.9)).toBe("success");
		expect(usageTone(60)).toBe("warning");
		expect(usageTone(80)).toBe("danger");
		expect(usageTone(null)).toBe("neutral");
	});
});

describe("country flags", () => {
	it("turns a two-letter code into a flag and refuses anything else", () => {
		expect(countryFlag("jp")).toBe("🇯🇵");
		expect(countryFlag(" US ")).toBe("🇺🇸");
		expect(countryFlag("JPN")).toBeNull();
		expect(countryFlag("1A")).toBeNull();
		expect(normalizeCountryCode("hk")).toBe("HK");
		expect(normalizeCountryCode("")).toBeNull();
	});

	it("names the country in the visitor's language, the same on server and browser", () => {
		expect(countryName("JP", "en")).toBe("Japan");
		expect(countryName("JP", "zh")).toBe("日本");
		// Fixed names, not the runtime's ICU data (which differs between Node and browsers).
		expect(countryName("hk", "zh")).toBe("香港");
		expect(countryName("BO", "zh")).toBe("BO");
	});
});
