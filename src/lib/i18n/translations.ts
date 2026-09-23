/** Complete server translation map, including API and background-service copy. */
import { browserTranslations } from "./browser-translations";
import { serviceTranslations } from "./service-translations";
import { makeT } from "./make-t";
import type { Locale } from "./core";

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

export const t = makeT(translations);

export function getAllTranslations(locale: Locale): Record<string, string> {
	return translations[locale] || translations.zh;
}

export { getServerLocale } from "./server-locale-cookie";

export { interpolate } from "./core";
export type { Locale, TFn } from "./core";
