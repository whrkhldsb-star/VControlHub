import { currentCopyLocale } from "./api-copy";
import type { Locale } from "./core";

/**
 * The viewer's language, for a page, a server action, a route or a service.
 *
 * Where a language is already settled, that is the answer:
 *  - inside an API route or a server action run through
 *    `withServerActionLocale`, the request's. A route that asked here got the
 *    platform default while the wrapper around it spoke the request's own
 *    language, two languages in one response for a token client;
 *  - in a process that serves no request (the worker, the terminal gateway),
 *    the platform's. There is no cookie to read there, so what services word
 *    through `serviceT()` (stored job errors, sync results) was Chinese on
 *    every platform.
 * Otherwise (a page): the locale cookie, then the platform default.
 */
export async function getServerLocale(): Promise<Locale> {
	const settled = currentCopyLocale();
	if (settled) return settled;
	try {
		const { cookies } = await import("next/headers");
		const store = await cookies();
		const cookie = store.get("vps-locale")?.value;
		if (cookie === "en" || cookie === "zh") return cookie;
		const { getPlatformDefaults } = await import("@/lib/settings/platform-defaults");
		return (await getPlatformDefaults()).locale;
	} catch {
		return "zh";
	}
}
