/**
 * React hook for i18n — locale switching with localStorage persistence.
 */
"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";
import { type Locale, t, getAllTranslations } from "./translations";

const STORAGE_KEY = "vps-locale";

interface I18nContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: (key: string) => string;
	translations: Record<string, string>;
}

const I18nContext = createContext<I18nContextValue>({
	locale: "zh",
	setLocale: () => {},
	t: (key) => key,
	translations: {},
});

export function useI18n() {
	return useContext(I18nContext);
}

export { I18nContext };

/**
 * Internal hook — used only by I18nProvider.
 * Components should use useI18n() instead.
 */
export function useLocale() {
	const [locale, setLocaleState] = useState<Locale>("zh");

	useEffect(() => {
		const saved = localStorage.getItem(STORAGE_KEY) as Locale | null;
		const initialLocale = saved === "zh" || saved === "en"
			? saved
			: navigator.language.startsWith("en")
				? "en"
				: "zh";
		setLocaleState(initialLocale);
		document.documentElement.lang = initialLocale === "zh" ? "zh-CN" : "en";
	}, []);

	const setLocale = useCallback((l: Locale) => {
		setLocaleState(l);
		localStorage.setItem(STORAGE_KEY, l);
		document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
	}, []);

	const translate = useCallback(
		(key: string) => t(key, locale),
		[locale]
	);

	const translations = getAllTranslations(locale);

	return { locale, setLocale, t: translate, translations };
}
