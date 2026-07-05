/**
 * React hook for i18n — locale switching with localStorage + cookie persistence.
 */
"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";
import { toHtmlLang } from "./locale-format";
import { type Locale, t, getAllTranslations } from "./translations";

const STORAGE_KEY = "vps-locale";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

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

function isLocale(value: string | null | undefined): value is Locale {
	return value === "zh" || value === "en";
}

function applyLocale(locale: Locale) {
	document.documentElement.lang = toHtmlLang(locale);
	document.documentElement.dataset.locale = locale;
}

function persistLocale(locale: Locale) {
	try {
		window.localStorage.setItem(STORAGE_KEY, locale);
	} catch {
		// Ignore storage failures.
	}
	document.cookie = `${STORAGE_KEY}=${locale}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

/**
 * Internal hook — used only by I18nProvider.
 * Components should use useI18n() instead.
 */
export function useLocale(initialLocale: Locale = "zh") {
	const [locale, setLocaleState] = useState<Locale>(initialLocale);

	useEffect(() => {
		let nextLocale: Locale = initialLocale;
		try {
			const saved = window.localStorage.getItem(STORAGE_KEY);
			if (isLocale(saved)) {
				nextLocale = saved;
			}
		} catch {
			// Keep initial locale from the server/cookie.
		}
		setLocaleState(nextLocale);
		applyLocale(nextLocale);
	}, [initialLocale]);

	useEffect(() => {
		applyLocale(locale);
	}, [locale]);

	const setLocale = useCallback((nextLocale: Locale) => {
		setLocaleState(nextLocale);
		applyLocale(nextLocale);
		persistLocale(nextLocale);
	}, []);

	const translate = useCallback(
		(key: string) => t(key, locale),
		[locale]
	);

	const translations = getAllTranslations(locale);

	return { locale, setLocale, t: translate, translations };
}
