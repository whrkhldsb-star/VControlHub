/**
 * `t()` factory (TR: one function body; translations.ts and
 * service-translations.ts used to duplicate it verbatim, differing only in
 * which dictionary map they read).
 *
 * Lookup rules, shared by every backend `t`:
 *   - locale defaults to "zh" when the second argument carries vars instead;
 *   - a missing key falls back to the key itself (visible in logs, greppable);
 *   - `{var}` placeholders interpolate via ./core's interpolate.
 */
import { interpolate, type Locale } from "./core";

export function makeT(dict: Record<Locale, Record<string, string>>) {
	return (
		key: string,
		localeOrVars?: Locale | Record<string, string | number>,
		maybeVars?: Record<string, string | number>,
	): string => {
		const locale: Locale = typeof localeOrVars === "string" ? localeOrVars : "zh";
		const vars = typeof localeOrVars === "object" ? localeOrVars : maybeVars;
		return interpolate(dict[locale]?.[key] || key, vars);
	};
}
