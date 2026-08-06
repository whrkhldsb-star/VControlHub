import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { browserTranslations } from "../browser-translations";
import { serviceTranslations } from "../service-translations";
import { translations } from "../translations";

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			return entry.name === "__tests__" || entry.name === "dictionaries" ? [] : sourceFiles(path);
		}
		return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

describe("translation bundle boundary", () => {
	it("keeps UI copy in the browser bundle", () => {
		expect(browserTranslations.zh["nav.dashboard"]).toBeTruthy();
		expect(browserTranslations.en["healthPage.error.loadStatus"]).toBeTruthy();
	});

	it("keeps service and API copy server-side", () => {
		for (const locale of ["zh", "en"] as const) {
			expect(browserTranslations[locale]["backend.storage.invalidPath"]).toBeUndefined();
			expect(browserTranslations[locale]["apiDownloads.urlInvalid"]).toBeUndefined();
			expect(serviceTranslations[locale]["nav.dashboard"]).toBeUndefined();
			expect(serviceTranslations[locale]["backend.storage.invalidPath"]).toBeTruthy();
			expect(translations[locale]["backend.storage.invalidPath"]).toBeTruthy();
			expect(translations[locale]["apiDownloads.urlInvalid"]).toBeTruthy();
		}
	});

	it("covers literal keys used by backend modules", () => {
		const backendFiles = sourceFiles(join(process.cwd(), "src/lib"));
		const missing = backendFiles.flatMap((file) => {
			const source = readFileSync(file, "utf8");
			if (
				!source.includes("@/lib/i18n/service-translations") &&
				!source.includes("@/lib/i18n/service-locale")
			) return [];
			return [...source.matchAll(/\bt\(\s*["'`]([^"'`${}]+)["'`]/g)]
				.map((match) => match[1]!)
				.filter((key) => !serviceTranslations.zh[key] || !serviceTranslations.en[key])
				.map((key) => `${file}:${key}`);
		});
		expect(missing).toEqual([]);

		const heavyImports = backendFiles.filter((file) => {
			const source = readFileSync(file, "utf8");
			return source.includes('from "@/lib/i18n/translations"') ||
				source.includes('from "@/lib/i18n/server-locale"');
		});
		expect(heavyImports).toEqual([]);
	});
});
