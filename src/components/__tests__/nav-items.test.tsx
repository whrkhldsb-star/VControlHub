import { describe, expect, it } from "vitest";

import { mainNavGroups, mainNavItems, systemNavGroup, systemNavItems } from "../nav-items";
import { en, zh } from "@/lib/i18n/dictionaries/nav";

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
		// Automation holds the 7 daily automation tools with /commands first as the primary action.
		for (const group of mainNavGroups) expect(group.items.length).toBeLessThanOrEqual(7);
		const automation = mainNavGroups.find((group) => group.id === "automation");
		expect(automation?.items[0]?.href).toBe("/commands");
	});

	it("keeps platform upkeep out of the daily groups", () => {
		const daily = mainNavItems.map((item) => item.href);
		for (const href of ["/settings", "/users", "/health", "/monitoring", "/backups", "/audit", "/itsm"]) {
			expect(daily).not.toContain(href);
			expect(systemNavItems.map((item) => item.href)).toContain(href);
		}
	});
});

describe("feature catalogue descriptions", () => {
	it("describes every page in one sentence in both languages", () => {
		for (const item of [...mainNavItems, ...systemNavItems]) {
			expect(item.descKey, item.href).toMatch(/^nav\.desc\./);
			expect(zh[item.descKey], `${item.href} zh`).toBeTruthy();
			expect(en[item.descKey], `${item.href} en`).toBeTruthy();
		}
	});

	it("keeps announcements with the overview and the system group flat", () => {
		const overview = mainNavGroups.find((group) => group.id === "overview");
		const assist = mainNavGroups.find((group) => group.id === "assist");
		expect(overview?.items.map((item) => item.href)).toEqual(["/dashboard", "/notifications", "/announcements"]);
		expect(assist?.items).toHaveLength(4);
		expect(systemNavGroup.items).toBe(systemNavItems);
	});

	it("draws the status board and its settings with different glyphs", () => {
		const glyph = (href: string) => {
			const icon = [...mainNavItems, ...systemNavItems].find((item) => item.href === href)?.icon as { type?: unknown } | undefined;
			return icon?.type;
		};
		expect(glyph("/public-status")).not.toBe(glyph("/vps-status"));
		expect(glyph("/public-status")).not.toBe(glyph("/status"));
		expect(glyph("/commands")).not.toBe(glyph("/templates"));
	});
});
