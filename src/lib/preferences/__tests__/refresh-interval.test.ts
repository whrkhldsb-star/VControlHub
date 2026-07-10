import { describe, expect, it } from "vitest";

import {
	DEFAULT_REFRESH_INTERVAL_SECONDS,
	getRefreshIntervalFromStorage,
	getRefreshIntervalLabel,
	normalizeRefreshIntervalSeconds,
} from "../refresh-interval";

describe("refresh interval preferences", () => {
	it("normalizes disabled, bounded, and invalid values", () => {
		expect(normalizeRefreshIntervalSeconds(0)).toBe(0);
		expect(normalizeRefreshIntervalSeconds(-5)).toBe(0);
		expect(normalizeRefreshIntervalSeconds(1)).toBe(5);
		expect(normalizeRefreshIntervalSeconds(15.9)).toBe(15);
		expect(normalizeRefreshIntervalSeconds(999)).toBe(300);
		expect(normalizeRefreshIntervalSeconds("bad", 60)).toBe(60);
	});

	it("reads the saved interval from local storage json", () => {
		const storage = { getItem: () => JSON.stringify({ autoRefreshInterval: 60 }) };
		expect(getRefreshIntervalFromStorage(storage)).toBe(60);
	});

	it("falls back when storage is missing or corrupt", () => {
		expect(getRefreshIntervalFromStorage(null)).toBe(DEFAULT_REFRESH_INTERVAL_SECONDS);
		expect(getRefreshIntervalFromStorage({ getItem: () => "not json" }, 15)).toBe(15);
	});

	it("formats intervals for UI labels", () => {
		expect(getRefreshIntervalLabel(0)).toBe("Manual refresh");
		expect(getRefreshIntervalLabel(30)).toBe("30s");
		expect(getRefreshIntervalLabel(300)).toBe("5 minutes");
	});
});
