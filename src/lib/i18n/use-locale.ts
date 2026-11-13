/**
 * React hook for i18n — locale switching with localStorage + cookie persistence.
 */
"use client";

import { useEffect, useState, useCallback, createContext, useContext } from "react";
import { toHtmlLang } from "./locale-format";
import { interpolate, type Locale } from "./core";

const STORAGE_KEY = "vps-locale";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface I18nContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
	locale: "zh",
	setLocale: () => {},
	// Without a provider (a component rendered on its own): the key itself, placeholders filled in.
	t: (key, vars) => interpolate(key, vars),
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
	// `secure` on https like the theme and sidebar cookies (A11-04).
	document.cookie = `${STORAGE_KEY}=${locale}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax${window.location.protocol === "https:" ? "; secure" : ""}`;
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
		// The server rendered `initialLocale` from the cookie (or from its default when the cookie is gone: it
		// lasts a year, and cookies get cleared while localStorage stays). The page then followed the stored
		// language while the server went on rendering, and wording its API answers, in the other one. Writing
		// the cookie again brings the server back to the language the person chose from the next request on.
		if (nextLocale !== initialLocale) persistLocale(nextLocale);
	}, [initialLocale]);

	useEffect(() => {
		applyLocale(locale);
	}, [locale]);

	const setLocale = useCallback((nextLocale: Locale) => {
		setLocaleState(nextLocale);
		applyLocale(nextLocale);
		persistLocale(nextLocale);
	}, []);

	return { locale, setLocale };
}
