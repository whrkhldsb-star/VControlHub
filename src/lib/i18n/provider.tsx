"use client";

import { type ReactNode, useMemo } from "react";
import { I18nContext, useLocale } from "@/lib/i18n/use-locale";
import { t as translate, getAllTranslations, type Locale } from "@/lib/i18n/translations";

export function I18nProvider({ children, initialLocale = "zh" }: { children: ReactNode; initialLocale?: Locale }) {
	const { locale, setLocale } = useLocale(initialLocale);

	const value = useMemo(() => ({
		locale,
		setLocale,
		t: (key: string) => translate(key, locale),
		translations: getAllTranslations(locale),
	}), [locale, setLocale]);

	return (
		<I18nContext.Provider value={value}>
			{children}
		</I18nContext.Provider>
	);
}
