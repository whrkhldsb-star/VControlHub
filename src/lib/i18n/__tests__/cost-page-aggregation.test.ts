/**
 * Aggregation smoke test — guarantees that the new `costPage.*` keys
 * (TR-031 E01) are present in BOTH the zh and en dicts AND are
 * spread into the global `translations` map. Locks the import /
 * spread path so a future refactor that drops the cost-page dict
 * breaks the build instead of silently rendering literal keys.
 */
import { describe, expect, it } from "vitest";

import { en, zh } from "../dictionaries/cost-page";
import { getAllTranslations, t } from "../translations";

describe("costPage i18n aggregation", () => {
	const REQUIRED_KEYS = [
		"costPage.title",
		"costPage.summary.total",
		"costPage.form.submit",
		"costPage.list.empty",
		"costPage.delete.confirm",
		"costPage.category.vps",
		"costPage.category.bandwidth",
		"costPage.category.storage",
		"costPage.category.other",
		"costPage.currency.CNY",
		"costPage.currency.USD",
	];

	it("zh dict has all required costPage.* keys", () => {
		for (const key of REQUIRED_KEYS) {
			expect(zh[key], `zh.${key} should be present`).toBeTypeOf("string");
			expect(zh[key]!.length, `zh.${key} should not be empty`).toBeGreaterThan(0);
		}
	});

	it("en dict has all required costPage.* keys", async () => {
		const dict = await getAllTranslations("en");
		for (const key of REQUIRED_KEYS) {
			expect(en[key], `en.${key} should be present`).toBeTypeOf("string");
			expect(en[key]!.length, `en.${key} should not be empty`).toBeGreaterThan(0);
			expect(dict[key], `global.${key} (en) should be present`).toBeTypeOf("string");
		}
	});

	it("global translations map includes costPage.* keys (zh + en)", () => {
		// Spot-check a handful of keys. If the spread is broken, these
		// will be undefined and `t("...")` would render the literal key.
		for (const key of REQUIRED_KEYS) {
			const zhValue = t(key, "zh");
			const enValue = t(key, "en");
			expect(zhValue, `t(${key}, zh) should not be the literal key`).not.toBe(key);
			expect(enValue, `t(${key}, en) should not be the literal key`).not.toBe(key);
		}
	});

	it("zh and en dicts have the same key set (no drift)", () => {
		const zhKeys = Object.keys(zh).sort();
		const enKeys = Object.keys(en).sort();
		expect(zhKeys).toEqual(enKeys);
	});
});
