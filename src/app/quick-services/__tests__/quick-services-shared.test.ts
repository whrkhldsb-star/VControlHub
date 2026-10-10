import { describe, expect, it } from "vitest";

import { SERVICE_CATALOG } from "@/lib/quick-service/catalog";
import { en, zh } from "@/lib/i18n/dictionaries/quick-services";
import { buildQuickServiceViewModel, localizeCatalogItem, type CatalogItem } from "../quick-services-shared";

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

describe("localizeCatalogItem", () => {
	const t = (dict: Record<string, string>) => (key: string) => dict[key] ?? key;

	it("names every built-in template in both languages", () => {
		for (const template of SERVICE_CATALOG) {
			for (const dict of [zh, en]) {
				expect(dict[`qsCatalog.${template.slug}.name`], template.slug).toBeTruthy();
				expect(dict[`qsCatalog.${template.slug}.description`], template.slug).toBeTruthy();
			}
		}
	});

	it("translates built-in templates and leaves third-party entries alone", () => {
		const alist = { slug: "alist", name: "AList Cloud Drive", description: "File listing program" };
		expect(localizeCatalogItem(alist, t(zh))).toMatchObject({ slug: "alist", name: "AList 网盘" });
		const custom = { slug: "my-app", name: "My App", description: "Mine" };
		expect(localizeCatalogItem(custom, t(zh))).toBe(custom);
	});
});
