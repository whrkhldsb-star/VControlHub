import { describe, expect, it } from "vitest";

import { withApiCopyLocale } from "../api-copy";
import { serviceTranslations, t } from "../service-translations";

const KEY = "backend.webdav.destinationExistsAndOverwriteIsF";

describe("service t() locale", () => {
	it("keeps Chinese outside an API request (workers, gateways)", () => {
		expect(t(KEY)).toBe(serviceTranslations.zh[KEY]);
	});

	it("follows the API request's locale when none is passed", () => {
		expect(withApiCopyLocale("en", () => t(KEY))).toBe(serviceTranslations.en[KEY]);
		expect(withApiCopyLocale("zh", () => t(KEY))).toBe(serviceTranslations.zh[KEY]);
	});

	it("lets an explicit locale win inside a request", () => {
		expect(withApiCopyLocale("en", () => t(KEY, "zh"))).toBe(serviceTranslations.zh[KEY]);
	});
});
