import { describe, expect, it } from "vitest";

import { buildQuickServiceViewModel, type CatalogItem } from "../quick-services-shared";

const item = (slug: string, status: string, category = "storage"): CatalogItem => ({
	slug, name: slug, category, icon: "", description: `${slug} service`, image: `${slug}:latest`,
	defaultPort: 80, internalPort: 80, path: "", status, id: null, containerId: null,
	port: null, error: null, source: "local",
});

describe("buildQuickServiceViewModel", () => {
	it("derives summary, search results and category groups in one passable model", () => {
		const model = buildQuickServiceViewModel(
			[item("alist", "running"), item("vaultwarden", "available")],
			[item("gitea", "error", "devtools")],
			"installed",
			"gitea",
		);

		expect(model.summary).toEqual({ running: 1, stopped: 0, error: 1, available: 1 });
		expect(model.grouped.devtools?.map((entry) => entry.slug)).toEqual(["gitea"]);
		expect(model.recommendedItems.map((entry) => entry.slug)).toEqual(["alist", "vaultwarden", "gitea"]);
	});
});
