/**
 * Test helpers — render a node with I18nProvider and other common providers
 * pre-wired so component tests can assert on localized text.
 *
 * Without `I18nProvider` in the tree, `useI18n()` falls back to the default
 * context, whose `t(key)` returns the key string itself (e.g. "common.save").
 * That's fine for the production app (root layout wraps everything) but
 * breaks tests that assert on translated Chinese/English text.
 */
"use client";

import { type ReactElement } from "react";
import { render, type RenderOptions } from "@testing-library/react";

import { I18nProvider } from "@/lib/i18n/provider";
import type { Locale } from "@/lib/i18n/translations";

interface I18nRenderOptions extends Omit<RenderOptions, "wrapper"> {
	locale?: Locale;
}

export function renderWithI18n(
	ui: ReactElement,
	{ locale = "zh", ...options }: I18nRenderOptions = {},
) {
	return render(ui, {
		wrapper: ({ children }) => (
			<I18nProvider initialLocale={locale}>{children}</I18nProvider>
		),
		...options,
	});
}
