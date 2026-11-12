/**
 * The language a request is answered in.
 *
 *  1. The one its sender chose on a page: the `vps-locale` cookie.
 *  2. For a browser of this app that never chose: the platform's default
 *     language, which is what its pages are shown in.
 *  3. Otherwise (API tokens, scripts): Accept-Language, then English.
 *
 * Step 2 was missing. Only switching the language writes the cookie, so a
 * browser that never switched had pages in the platform default and API
 * messages by its Accept-Language: English errors on the Chinese pages of a
 * default installation for an English-language browser, and the reverse on an
 * English installation.
 */
import type { Locale } from "@/lib/i18n/core";
import { getPlatformDefaults } from "@/lib/settings/platform-defaults";

function chosenLocale(cookie: string): Locale | null {
	const match = /(?:^|;\s*)vps-locale=(en|zh)(?:;|$)/.exec(cookie);
	return match ? (match[1] as Locale) : null;
}

/**
 * A browser of this app rather than a script: one of its pages made the
 * request (the browser says so), or it carries the app's cookies and no
 * token. The second covers browsers without fetch metadata and plain
 * navigation to a download link.
 */
function sentByBrowserOfThisApp(request: Request, cookie: string): boolean {
	if (header(request, "authorization")) return false;
	return header(request, "sec-fetch-site") === "same-origin" || cookie !== "";
}

/** Tolerates the header-less request doubles some callers' tests pass. */
function header(request: Request, name: string): string {
	return request.headers?.get?.(name) ?? "";
}

export async function requestLocale(request: Request): Promise<Locale> {
	const cookie = header(request, "cookie");
	const chosen = chosenLocale(cookie);
	if (chosen) return chosen;
	// Never throws; cached per process for 15 s, as the root layout reads it.
	if (sentByBrowserOfThisApp(request, cookie)) return (await getPlatformDefaults()).locale;
	return /^zh(?:-|$)/i.test(header(request, "accept-language")) ? "zh" : "en";
}
