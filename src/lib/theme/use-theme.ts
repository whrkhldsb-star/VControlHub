/**
 * Theme management — dark/light mode toggle with localStorage persistence.
 */
"use client";

import { useEffect, useState, useCallback } from "react";

export type Theme = "dark" | "light";

const STORAGE_KEY = "vps-theme";

export function useTheme() {
	const [theme, setThemeState] = useState<Theme>("dark");

	// Initialize from localStorage
	useEffect(() => {
		const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
		if (stored === "light" || stored === "dark") {
			setThemeState(stored);
			document.documentElement.classList.toggle("light", stored === "light");
		} else {
			// Default: dark
			document.documentElement.classList.remove("light");
		}
	}, []);

	const setTheme = useCallback((t: Theme) => {
		setThemeState(t);
		localStorage.setItem(STORAGE_KEY, t);
		document.documentElement.classList.toggle("light", t === "light");
	}, []);

	const toggleTheme = useCallback(() => {
		setTheme(theme === "dark" ? "light" : "dark");
	}, [theme, setTheme]);

	return { theme, setTheme, toggleTheme };
}
