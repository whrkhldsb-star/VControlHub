import { describe, expect, it } from "vitest";

import { getSearchItems, searchItemMetadata } from "../global-search";
import { mainNavItems, systemNavItems } from "../nav-items";
import { en, zh } from "@/lib/i18n/dictionaries/search";

describe("global search catalog", () => {
	it("does not include stale routes for renamed pages", () => {
		const hrefs = getSearchItems().map((item) => item.href);

		expect(hrefs).toContain("/quick-services");
		expect(hrefs).toContain("/backups");
		expect(hrefs).toContain("/servers");
		expect(hrefs).not.toContain("/quickservice");
		expect(hrefs).not.toContain("/backup");
		expect(hrefs).not.toContain("/ssh");
	});

	it("gives every navigation page search words in both languages", () => {
		for (const item of [...mainNavItems, ...systemNavItems]) {
			expect(searchItemMetadata[item.href]?.keywordsKey, item.href).toBeTruthy();
			for (const locale of ["zh", "en"] as const) {
				const entry = getSearchItems(locale).find((searchItem) => searchItem.href === item.href);
				expect(entry?.keywords?.length, `${item.href} ${locale}`).toBeGreaterThan(0);
			}
		}
	});

	it("separates search words with a bar, never with spaces alone", () => {
		for (const dictionary of [zh, en]) {
			expect(dictionary["search.keywords.knowledge"]).toContain("|");
		}
	});

	it("describes every navigation page under its name", () => {
		const items = getSearchItems("en");
		for (const navItem of [...mainNavItems, ...systemNavItems]) {
			const item = items.find((entry) => entry.href === navItem.href && entry.description);
			expect(item?.description, navItem.href).toBeTruthy();
		}
	});

	it("lists tasks by what people want done, each behind the permission it needs", () => {
		const hrefs = getSearchItems("en").map((item) => `${item.href} ${item.label}`);
		expect(hrefs).toEqual(expect.arrayContaining([
			"/servers#servers-create Add a server",
			"/users Create a user account",
			"/settings#smtp Set up email notifications (SMTP)",
			"/backups Create a backup",
			"/ai Set up AI models",
			"/api-tokens Create an API token",
		]));
	});
});
