/**
 * Server-side locale helpers.
 *
 * Server actions can't use `useI18n()`, but the user's locale is persisted
 * in the `vps-locale` cookie (set by `use-locale.ts`). Locale resolution lives
 * in `server-locale-cookie.getServerLocale`; this module adds
 * convenience wrappers for server actions.
 */

import { t as translate, type Locale, type TFn } from "./translations";
import { getServerLocale } from "./server-locale-cookie";

export { getServerLocale };
export type { Locale };

/**
 * Convenience: produce a `t(key)` function bound to the request locale.
 * Use inside a server action: `const t = await serverT(); return { success: t("storagePage.action.success") }`.
 */
export async function serverT(): Promise<TFn> {
	const locale = await getServerLocale();
	return (key: string, vars?: Record<string, string | number>) => translate(key, locale, vars);
}
