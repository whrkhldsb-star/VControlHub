"use client";

import { useI18n } from "@/lib/i18n/use-locale";

/** First focusable element: jumps keyboard users past the navigation. */
export function SkipLink() {
	const { t } = useI18n();
	return (
		<a
			href="#main-content"
			className="fixed left-3 top-3 z-[var(--z-toast)] -translate-y-24 rounded-md bg-[var(--color-action)] px-3 py-2 text-sm font-medium text-[var(--color-action-fg)] shadow-[var(--shadow-md)] transition focus-visible:translate-y-0"
		>
			{t("shell.skipToContent")}
		</a>
	);
}
