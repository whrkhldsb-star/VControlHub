/**
 * Server-side locale helpers.
 *
 * Server actions can't use `useI18n()`, but the user's locale is persisted
 * in the `vps-locale` cookie (set by `use-locale.ts`). Locale resolution lives
 * in `translations.getServerLocale` (single source of truth); this module adds
 * convenience wrappers for server actions.
 */

import { t as translate, type Locale, getServerLocale } from "./translations";

export { getServerLocale };
export type { Locale };

/**
 * Convenience: produce a `t(key)` function bound to the request locale.
 * Use inside a server action: `const t = await serverT(); return { success: t("storagePage.action.success") }`.
 */
export async function serverT(): Promise<(key: string) => string> {
	const locale = await getServerLocale();
	return (key: string) => translate(key, locale);
}

