"use client";

import { useEffect, useState } from "react";
import { createLogger } from "@/lib/logging";
import { ActionButton } from "@/components/action-button";

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
		colon: "\uff1a",
		retry: "\u91cd\u8bd5",
	},
	en: {
		lang: "en",
		title: "Something went wrong",
		description: "An unexpected error occurred. Please try refreshing the page. If the problem persists, contact the administrator.",
		digestLabel: "Error ID",
		colon: ": ",
		retry: "Retry",
	},
} as const;

export default function GlobalError({
	error,
	reset,
	retry,
}: {
	error: Error & { digest?: string };
	/** Clears the boundary and renders what it already has. */
	reset: () => void;
	/**
	 * Fetches the page again first. After a failure in the root layout, what the boundary already has is that
	 * failure: `reset` alone brought this screen straight back.
	 */
	retry?: () => void;
}) {
	const [locale] = useState<Locale>(detectLocale);

	useEffect(() => {
		logger.error("global error boundary captured error", error);
	}, [error]);

	const c = copy[locale];

	// global-error replaces <html> and sits outside the normal layout tree, so the design tokens of
	// globals.css may not be there. The inline values are the dark theme's tokens (tokens.css): the screen
	// used another near-black and a cyan button that appear nowhere else in the application.
	return (
		<html lang={c.lang}>
			<body
				className="m-0 bg-[var(--surface-root,#0e1014)] p-0 font-sans text-[var(--text-primary,#eceef1)]"
				style={{ backgroundColor: "#0e1014", color: "#eceef1" }}
			>
				<div className="mx-auto max-w-[600px] px-6 py-20 text-center">
					<h1
						className="mb-3 text-3xl font-semibold text-[var(--text-primary,#eceef1)]"
						style={{ color: "#eceef1" }}
					>
						{c.title}
					</h1>
					<p
						className="mb-6 text-base leading-relaxed text-[var(--text-secondary,#b4bac4)]"
						style={{ color: "#b4bac4" }}
					>
						{c.description}
					</p>
					{error.digest && (
						<p
							className="mb-4 text-xs text-[var(--text-muted,#8a93a0)]"
							style={{ color: "#8a93a0" }}
						>
							{c.digestLabel}{c.colon}{error.digest}
						</p>
					)}
					<ActionButton size="lg" type="button" variant="primary"
						onClick={retry ?? reset}
						style={{
							backgroundColor: "#5260e8",
							color: "#ffffff",
							border: "none",
							borderRadius: "0.5rem",
							cursor: "pointer",
							fontWeight: 600,
						}}>
						{c.retry}
					</ActionButton>
				</div>
			</body>
		</html>
	);
}
