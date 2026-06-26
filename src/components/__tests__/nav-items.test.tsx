import { describe, expect, it } from "vitest";

import { mainNavItems } from "../nav-items";

const DISCOVERABLE_FEATURE_ROUTES = [
	"/monitoring",
	"/settings",
	"/cost-summary",
	"/ai-ops",
	"/image-bed",
] as const;

describe("mainNavItems", () => {
	it("exposes the standalone feature pages called out in the README", () => {
		const hrefs = mainNavItems.map((item) => item.href);

		for (const route of DISCOVERABLE_FEATURE_ROUTES) {
			expect(hrefs).toContain(route);
		}
	});
});
