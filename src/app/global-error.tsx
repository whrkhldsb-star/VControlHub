"use client";

import { useEffect, useState } from "react";

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
		title: "出错了",
		description: "页面遇到了意外错误，请尝试刷新。如果问题持续出现，请联系管理员。",
		digestLabel: "错误标识",
		retry: "重试",
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
	const [locale, setLocale] = useState<Locale>("zh");

	useEffect(() => {
		setLocale(detectLocale());
		console.error("[GlobalError]", error);
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
