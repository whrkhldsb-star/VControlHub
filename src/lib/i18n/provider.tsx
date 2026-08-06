"use client";

import { type ReactNode, useMemo } from "react";
import { I18nContext, useLocale } from "@/lib/i18n/use-locale";
import {
	browserT,
	type Locale,
} from "@/lib/i18n/browser-translations";

export function I18nProvider({ children, initialLocale = "zh" }: { children: ReactNode; initialLocale?: Locale }) {
	const { locale, setLocale } = useLocale(initialLocale);

	const value = useMemo(() => ({
		locale,
		setLocale,
		t: (key: string, vars?: Record<string, string | number>) => browserT(key, locale, vars),
	}), [locale, setLocale]);

	return (
		<I18nContext.Provider value={value}>
			{children}
		</I18nContext.Provider>
	);
}
