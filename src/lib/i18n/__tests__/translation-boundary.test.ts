import { describe, expect, it } from "vitest";

import { browserTranslations } from "../browser-translations";
import { translations } from "../translations";

describe("translation bundle boundary", () => {
	it("keeps UI copy in the browser bundle", () => {
		expect(browserTranslations.zh["nav.dashboard"]).toBeTruthy();
		expect(browserTranslations.en["healthPage.error.loadStatus"]).toBeTruthy();
	});

	it("keeps service and API copy server-side", () => {
		for (const locale of ["zh", "en"] as const) {
			expect(browserTranslations[locale]["backend.storage.invalidPath"]).toBeUndefined();
			expect(browserTranslations[locale]["apiDownloads.urlInvalid"]).toBeUndefined();
			expect(translations[locale]["backend.storage.invalidPath"]).toBeTruthy();
			expect(translations[locale]["apiDownloads.urlInvalid"]).toBeTruthy();
		}
	});
});
