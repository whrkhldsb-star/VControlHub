import { describe, expect, it } from "vitest";

import { browserT } from "@/lib/i18n/browser-translations";

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

	// The label was English whatever the page's language: "自动刷新中（5 minutes）".
	it("names an interval in the page's language, as the preferences do", () => {
		const zh = (key: string, vars?: Record<string, string | number>) => browserT(key, "zh", vars);
		const en = (key: string, vars?: Record<string, string | number>) => browserT(key, "en", vars);
		expect([0, 30, 300].map((seconds) => getRefreshIntervalLabel(seconds, zh))).toEqual(["关闭", "30 秒", "5 分钟"]);
		expect([0, 30, 300].map((seconds) => getRefreshIntervalLabel(seconds, en))).toEqual(["Off", "30 seconds", "5 minutes"]);
		// One the preferences do not offer.
		expect(getRefreshIntervalLabel(45, zh)).toBe("45 秒");
		expect(getRefreshIntervalLabel(45, en)).toBe("45 seconds");
	});
});
