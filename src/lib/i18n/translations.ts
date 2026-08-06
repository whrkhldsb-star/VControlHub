/** Complete server translation map, including API and background-service copy. */
import { browserTranslations } from "./browser-translations";
import { serviceTranslations } from "./service-translations";
import { interpolate, type Locale } from "./core";

export const translations: Record<Locale, Record<string, string>> = {
	zh: {
		...browserTranslations.zh,
		...serviceTranslations.zh,
	},
	en: {
		...browserTranslations.en,
		...serviceTranslations.en,
	},
};

export function t(
	key: string,
	localeOrVars?: Locale | Record<string, string | number>,
	maybeVars?: Record<string, string | number>,
): string {
	const locale: Locale = typeof localeOrVars === "string" ? localeOrVars : "zh";
	const vars = typeof localeOrVars === "object" ? localeOrVars : maybeVars;
	return interpolate(translations[locale]?.[key] || key, vars);
}

export function getAllTranslations(locale: Locale): Record<string, string> {
	return translations[locale] || translations.zh;
}

export { getServerLocale } from "./server-locale-cookie";

export { interpolate } from "./core";
export type { Locale, TFn } from "./core";
