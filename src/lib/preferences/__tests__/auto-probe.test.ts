import { describe, expect, it } from "vitest";

import {
	AUTO_PROBE_ALLOWED_INTERVALS,
	AUTO_PROBE_INTERVAL_OPTIONS,
	DEFAULT_AUTO_PROBE_INTERVAL_SEC,
	MAX_AUTO_PROBE_INTERVAL_SEC,
	MIN_AUTO_PROBE_INTERVAL_SEC,
	getAutoProbeIntervalLabel,
	normalizeAutoProbeIntervalSec,
} from "../auto-probe";

describe("auto-probe interval constants", () => {
	it("exposes the documented five preset options", () => {
		expect(AUTO_PROBE_INTERVAL_OPTIONS.map((o) => o.value)).toEqual([10, 30, 60, 120, 300]);
	});

	it("uses a 60 second default", () => {
		expect(DEFAULT_AUTO_PROBE_INTERVAL_SEC).toBe(60);
	});

	it("declares a sane min/max range", () => {
		expect(MIN_AUTO_PROBE_INTERVAL_SEC).toBe(10);
		expect(MAX_AUTO_PROBE_INTERVAL_SEC).toBe(300);
		expect(AUTO_PROBE_ALLOWED_INTERVALS).toContain(DEFAULT_AUTO_PROBE_INTERVAL_SEC);
	});
});

describe("normalizeAutoProbeIntervalSec", () => {
	it("returns the fallback for nullish / non-numeric input", () => {
		expect(normalizeAutoProbeIntervalSec(null)).toBe(DEFAULT_AUTO_PROBE_INTERVAL_SEC);
		expect(normalizeAutoProbeIntervalSec(undefined)).toBe(DEFAULT_AUTO_PROBE_INTERVAL_SEC);
		expect(normalizeAutoProbeIntervalSec("abc")).toBe(DEFAULT_AUTO_PROBE_INTERVAL_SEC);
	});

	it("returns the fallback for sub-allowlist values", () => {
		// 5 is below the minimum, 90 isn't in the preset list, 0 means "off"
		expect(normalizeAutoProbeIntervalSec(5)).toBe(DEFAULT_AUTO_PROBE_INTERVAL_SEC);
		expect(normalizeAutoProbeIntervalSec(0)).toBe(DEFAULT_AUTO_PROBE_INTERVAL_SEC);
		expect(normalizeAutoProbeIntervalSec(90)).toBe(DEFAULT_AUTO_PROBE_INTERVAL_SEC);
	});

	it("accepts every preset value", () => {
		for (const option of AUTO_PROBE_INTERVAL_OPTIONS) {
			expect(normalizeAutoProbeIntervalSec(option.value)).toBe(option.value);
		}
	});

	it("coerces numeric strings", () => {
		expect(normalizeAutoProbeIntervalSec("60")).toBe(60);
		expect(normalizeAutoProbeIntervalSec("300")).toBe(300);
	});

	it("honours a custom fallback", () => {
		expect(normalizeAutoProbeIntervalSec("garbage", 30)).toBe(30);
		expect(normalizeAutoProbeIntervalSec(0, 120)).toBe(120);
	});
});

describe("getAutoProbeIntervalLabel", () => {
	it("returns the matching preset label", () => {
		expect(getAutoProbeIntervalLabel(10)).toBe("10 seconds");
		expect(getAutoProbeIntervalLabel(60)).toBe("1 minute");
		expect(getAutoProbeIntervalLabel(300)).toBe("5 minutes");
	});

	it("falls back to the default label for unknown values", () => {
		expect(getAutoProbeIntervalLabel(0)).toBe("1 minute");
		expect(getAutoProbeIntervalLabel(9999)).toBe("1 minute");
	});
});
