import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useLocale } from "../use-locale";

const cookie = () => /(?:^|;\s*)vps-locale=(\w+)/.exec(document.cookie)?.[1];
const clearCookie = () => {
	document.cookie = "vps-locale=; path=/; max-age=0";
};

/**
 * The language is kept twice: in localStorage, which the page reads, and in a cookie, which the server reads
 * for what it renders and for the sentences of API answers. The switch writes both. When only the cookie is
 * gone (it lasts a year; cookies get cleared) the page went back to the stored language by itself while the
 * server kept answering in the default one: two languages on one screen, with nothing to click to mend it
 * short of switching away and back.
 */
describe("useLocale", () => {
	beforeEach(() => {
		window.localStorage.clear();
		clearCookie();
	});
	afterEach(() => {
		window.localStorage.clear();
		clearCookie();
	});

	it("writes the cookie again when the stored language is not the one the server rendered", () => {
		window.localStorage.setItem("vps-locale", "en");
		const { result } = renderHook(() => useLocale("zh"));
		expect(result.current.locale).toBe("en");
		expect(document.documentElement.dataset.locale).toBe("en");
		expect(cookie()).toBe("en");
	});

	it("leaves the cookie alone when nothing is stored or both agree", () => {
		const first = renderHook(() => useLocale("zh"));
		expect(first.result.current.locale).toBe("zh");
		expect(cookie()).toBeUndefined();
		first.unmount();

		window.localStorage.setItem("vps-locale", "zh");
		const second = renderHook(() => useLocale("zh"));
		expect(second.result.current.locale).toBe("zh");
		expect(cookie()).toBeUndefined();
	});

	it("ignores a stored value that is not a language", () => {
		window.localStorage.setItem("vps-locale", "fr");
		const { result } = renderHook(() => useLocale("en"));
		expect(result.current.locale).toBe("en");
		expect(cookie()).toBeUndefined();
	});

	it("keeps both in step when the language is switched", () => {
		const { result } = renderHook(() => useLocale("zh"));
		act(() => result.current.setLocale("en"));
		expect(result.current.locale).toBe("en");
		expect(window.localStorage.getItem("vps-locale")).toBe("en");
		expect(cookie()).toBe("en");
	});
});
