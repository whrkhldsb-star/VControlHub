/**
 * Theme management — app-wide dark/light mode with localStorage + cookie persistence.
 */
"use client";

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "vps-theme";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

interface ThemeContextValue {
	theme: Theme;
	setTheme: (theme: Theme) => void;
	toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: string | null | undefined): value is Theme {
	return value === "dark" || value === "light";
}

function persistTheme(theme: Theme) {
	try {
		window.localStorage.setItem(STORAGE_KEY, theme);
	} catch {
		// Ignore storage failures (private mode, disabled storage, etc.).
	}
	document.cookie = `${STORAGE_KEY}=${theme}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`;
}

function applyTheme(theme: Theme) {
	document.documentElement.classList.toggle("light", theme === "light");
	document.documentElement.dataset.theme = theme;
}

export function ThemeProvider({ children, initialTheme = "dark" }: { children: ReactNode; initialTheme?: Theme }) {
	const [theme, setThemeState] = useState<Theme>(initialTheme);

	useEffect(() => {
		let nextTheme: Theme = initialTheme;
		try {
			const stored = window.localStorage.getItem(STORAGE_KEY);
			if (isTheme(stored)) nextTheme = stored;
		} catch {
			// Keep initial theme from the server/cookie.
		}
		setThemeState(nextTheme);
		applyTheme(nextTheme);
	}, [initialTheme]);

	const setTheme = useCallback((nextTheme: Theme) => {
		setThemeState(nextTheme);
		applyTheme(nextTheme);
		persistTheme(nextTheme);
	}, []);

	const toggleTheme = useCallback(() => {
		setThemeState((current) => {
			const nextTheme = current === "dark" ? "light" : "dark";
			applyTheme(nextTheme);
			persistTheme(nextTheme);
			return nextTheme;
		});
	}, []);

	const value = useMemo(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

	return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme() {
	const context = useContext(ThemeContext);
	if (!context) {
		throw new Error("useTheme must be used within ThemeProvider");
	}
	return context;
}
