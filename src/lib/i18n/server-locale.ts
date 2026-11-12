/**
 * Server-side locale helpers.
 *
 * Server actions can't use `useI18n()`, but the user's locale is persisted
 * in the `vps-locale` cookie (set by `use-locale.ts`). Locale resolution lives
 * in `server-locale-cookie.getServerLocale`; this module adds
 * convenience wrappers for server actions.
 */

import { withApiCopyLocale } from "./api-copy";
import { t as translate, type TFn } from "./translations";
import { getServerLocale } from "./server-locale-cookie";

export { getServerLocale };

/**
 * Convenience: produce a `t(key)` function bound to the request locale.
 * Use inside a server action: `const t = await serverT(); return { success: t("storagePage.action.success") }`.
 */
export async function serverT(): Promise<TFn> {
	const locale = await getServerLocale();
	return (key: string, vars?: Record<string, string | number>) => translate(key, locale, vars);
}

/**
 * Runs a server action with the user's locale as the locale of the backend copy, as `withApiRoute` does for an
 * API route. Without it the action has no request for that copy to read a language from: `apiCopy()` answered in
 * English and the service-layer `t()` in Chinese whatever the page's language was — a Chinese page was told
 * "Another operation is active on this storage node", an English one got its access refusal in Chinese.
 *
 * Every exported action of a "use server" module goes through this:
 *   export async function saveAction(prev, formData) {
 *     return withServerActionLocale(() => saveActionImpl(prev, formData));
 *   }
 */
export async function withServerActionLocale<T>(action: () => Promise<T>): Promise<T> {
	return withApiCopyLocale(await getServerLocale(), action);
}
