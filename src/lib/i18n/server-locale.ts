/**
 * Server-side locale helpers.
 *
 * Server actions can't use `useI18n()`, but the user's locale is persisted
 * in the `vps-locale` cookie (set by `use-locale.ts`). Read it here so server
 * actions can produce localised `success` / `error` messages that match the
 * client side language toggle.
 */

import { cookies } from "next/headers";

import { t as translate, type Locale, getAllTranslations } from "./translations";

const LOCALE_COOKIE = "vps-locale";

export async function getServerLocale(): Promise<Locale> {
	try {
		const store = await cookies();
		const raw = store.get(LOCALE_COOKIE)?.value;
		return raw === "en" ? "en" : "zh";
	} catch {
		// Called outside a request scope (e.g. from a vitest unit test or a
		// background task). Default to en so messages are in English.
		return "en";
	}
}

/**
 * Convenience: produce a `t(key)` function bound to the request locale.
 * Use inside a server action: `const t = await serverT(); return { success: t("storagePage.action.success") }`.
 */
export async function serverT(): Promise<(key: string) => string> {
	const locale = await getServerLocale();
	return (key: string) => translate(key, locale);
}

/**
 * Convenience: get all translations as a flat dict for the request locale.
 * Useful when a server-side helper needs to look up multiple keys without
 * calling `serverT()` per lookup.
 */
export async function serverTranslations(): Promise<Record<string, string>> {
	const locale = await getServerLocale();
	return getAllTranslations(locale);
}
