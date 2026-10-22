"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

import type { Locale } from "./core";
import { useI18n } from "./use-locale";

/**
 * Switch the interface language everywhere on the page. Client text follows
 * the context at once; text rendered on the server (page titles and
 * descriptions) only follows when the page is fetched again with the new
 * cookie, so the switch refreshes it. It used to leave both languages on
 * screen until the next navigation.
 */
export function useSwitchLocale() {
	const { setLocale } = useI18n();
	const router = useRouter();
	return useCallback((next: Locale) => {
		setLocale(next);
		router.refresh();
	}, [setLocale, router]);
}
