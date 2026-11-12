// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	cookie: undefined as string | undefined,
	outsideRequest: false,
	getPlatformDefaults: vi.fn(),
}));

vi.mock("next/headers", () => ({
	cookies: async () => {
		if (mocks.outsideRequest) throw new Error("`cookies` was called outside a request scope");
		return { get: (name: string) => (name === "vps-locale" && mocks.cookie ? { value: mocks.cookie } : undefined) };
	},
}));
vi.mock("@/lib/settings/platform-defaults", () => ({ getPlatformDefaults: mocks.getPlatformDefaults }));

import { setBackgroundCopyLocale, withApiCopyLocale } from "../api-copy";
import { getServerLocale } from "../server-locale-cookie";
import { serviceT } from "../service-locale";
import { serviceTranslations } from "../service-translations";

const KEY = "backend.request.bodyTooLarge";

describe("getServerLocale", () => {
	beforeEach(() => {
		mocks.cookie = undefined;
		mocks.outsideRequest = false;
		mocks.getPlatformDefaults.mockResolvedValue({ locale: "en", theme: "dark" });
		setBackgroundCopyLocale(undefined);
	});
	afterEach(() => {
		setBackgroundCopyLocale(undefined);
	});

	it("is the viewer's choice on a page, then the platform default", async () => {
		mocks.cookie = "zh";
		expect(await getServerLocale()).toBe("zh");

		mocks.cookie = undefined;
		expect(await getServerLocale()).toBe("en");
	});

	// A route asked here and got the platform default while the wrapper around it had settled on the
	// request's own language: two languages in one response.
	it("is the language already settled for the request inside a route or a server action", async () => {
		mocks.cookie = "zh";

		expect(await withApiCopyLocale("en", () => getServerLocale())).toBe("en");
		expect(mocks.getPlatformDefaults).not.toHaveBeenCalled();
	});

	// The worker has no request to read a cookie from, so this was Chinese on every platform: what
	// services word through serviceT() (stored job errors, sync results) ignored the platform's language.
	it("is the process's language where no request is served", async () => {
		mocks.outsideRequest = true;
		setBackgroundCopyLocale("en");

		expect(await getServerLocale()).toBe("en");
		expect((await serviceT())(KEY)).toBe(serviceTranslations.en[KEY]);
	});

	it("stays Chinese outside a request while no language is known at all", async () => {
		mocks.outsideRequest = true;

		expect(await getServerLocale()).toBe("zh");
	});
});
