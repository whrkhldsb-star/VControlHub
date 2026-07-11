"use client";

import { useEffect, useState } from "react";
import { createLogger } from "@/lib/logging";

const logger = createLogger("global-error");

/**
 * Global Error Boundary — catches unhandled errors in any route segment.
 * Without this, an uncaught exception renders a blank white page.
 * Placed at src/app/global-error.tsx (app router convention).
 *
 * NOTE: This component renders OUTSIDE the React provider tree (it replaces
 * <html>), so it cannot use useI18n(). Locale is detected from the
 * `vps-locale` cookie — the same cookie the I18nProvider reads/writes.
 */

type Locale = "zh" | "en";

function detectLocale(): Locale {
	if (typeof document !== "undefined") {
		const match = document.cookie.match(/(?:^|;\s*)vps-locale=(\w+)/);
		if (match?.[1] === "en") return "en";
	}
	return "zh";
}

const copy = {
	zh: {
		lang: "zh-CN",
		title: "\u51fa\u9519\u4e86",
		description: "\u9875\u9762\u9047\u5230\u4e86\u610f\u5916\u9519\u8bef\uff0c\u8bf7\u5c1d\u8bd5\u5237\u65b0\u3002\u5982\u679c\u95ee\u9898\u6301\u7eed\u51fa\u73b0\uff0c\u8bf7\u8054\u7cfb\u7ba1\u7406\u5458\u3002",
		digestLabel: "\u9519\u8bef\u6807\u8bc6",
		retry: "\u91cd\u8bd5",
	},
	en: {
		lang: "en",
		title: "Something went wrong",
		description: "An unexpected error occurred. Please try refreshing the page. If the problem persists, contact the administrator.",
		digestLabel: "Error ID",
		retry: "Retry",
	},
} as const;

export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const [locale] = useState<Locale>(detectLocale);

	useEffect(() => {
		logger.error("global error boundary captured error", error);
	}, [error]);

	const c = copy[locale];

	return (
		<html lang={c.lang}>
			<body className="m-0 bg-[var(--surface-root)] p-0 font-sans text-[var(--text-primary)]">
				<div className="mx-auto max-w-[600px] px-6 py-20 text-center">
					<h1 className="mb-3 text-3xl font-semibold text-[var(--text-primary)]">{c.title}</h1>
					<p className="mb-6 text-base leading-relaxed text-[var(--text-secondary)]">
						{c.description}
					</p>
					{error.digest && (
						<p className="mb-4 text-xs text-[var(--text-muted)]">{c.digestLabel}: {error.digest}</p>
					)}
					<button
						onClick={reset}
						className="rounded-lg bg-[var(--color-action)] px-7 py-2.5 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--color-action-hover)]"
					>
						{c.retry}
					</button>
				</div>
			</body>
		</html>
	);
}
