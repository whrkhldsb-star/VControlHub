import { describe, expect, it } from "vitest";

import { mainNavGroups, mainNavItems, systemNavItems } from "../nav-items";

const DISCOVERABLE_FEATURE_ROUTES = [
	"/monitoring",
	"/settings",
	"/cost-summary",
	"/ai-ops",
	"/image-bed",
] as const;

describe("mainNavItems", () => {
	it("exposes the standalone feature pages called out in the README", () => {
		const hrefs = [...mainNavItems, ...systemNavItems].map((item) => item.href);

		for (const route of DISCOVERABLE_FEATURE_ROUTES) {
			expect(hrefs).toContain(route);
		}
	});
});

describe("navigation catalogue", () => {
	it("lists every page exactly once", () => {
		const hrefs = [...mainNavItems, ...systemNavItems].map((item) => item.href);
		expect(new Set(hrefs).size).toBe(hrefs.length);
	});

	it("keeps groups short enough to scan", () => {
		for (const group of mainNavGroups) expect(group.items.length).toBeLessThanOrEqual(6);
	});

	it("keeps platform upkeep out of the daily groups", () => {
		const daily = mainNavItems.map((item) => item.href);
		for (const href of ["/settings", "/users", "/health", "/monitoring", "/backups", "/audit", "/itsm"]) {
			expect(daily).not.toContain(href);
			expect(systemNavItems.map((item) => item.href)).toContain(href);
		}
	});
});
