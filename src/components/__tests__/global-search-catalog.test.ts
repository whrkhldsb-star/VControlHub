import { describe, expect, it } from "vitest";

import { getSearchItems } from "../global-search";

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
});
