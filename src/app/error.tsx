"use client";

import NextLink from "next/link";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { PermissionDenied } from "@/components/page-shell";
import { createLogger } from "@/lib/logging";

const logger = createLogger("root-error");

/**
 * Root-level error boundary for route segments.
 * Catches errors thrown in Server Components and Client Components
 * within the shared layout. Falls back gracefully with a retry button.
 *
 * Note: This does NOT catch errors in root layout.tsx —
 * for that, global-error.tsx is used instead.
 *
 * TR-030 / 56 multi-tenant (Tick 3): recognise `ForbiddenError` thrown by
 * `requirePagePermission()` and render the shared `<PermissionDenied />`
 * surface instead of the generic error message. This is the second-line
 * guard — even if a client surface forgets to hide its UI, the page entry
 * still bounces unauthorised users to a consistent denial state.
 */
export default function RootError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	const { t } = useI18n();

	useEffect(() => {
		// Surface unexpected errors to the console so the cron / smoke
		// pipeline can pick them up. ForbiddenError is intentional, not
		// a defect, but we still log it for audit.
		if (error.name !== "ForbiddenError") {
			logger.error("root error boundary captured error", error);
		}
	}, [error]);

	if (error.name === "ForbiddenError") {
		return <PermissionDenied />;
	}

	return (
		<div className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-6 py-16 text-center">
			<div className="w-full rounded-3xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-8 shadow-[var(--shadow-md)] backdrop-blur">
				<div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-bg)] text-xl" aria-hidden="true">
					!
				</div>
				<h2 className="mb-3 text-2xl font-semibold text-[var(--text-primary)]">
					{t("error.title")}
				</h2>
				<p className="mb-2 text-sm leading-relaxed text-[var(--text-secondary)]">
					{error.message || t("error.unknown")}
				</p>
				{error.digest && (
					<p className="mb-4 text-xs text-[var(--text-muted)]">
						{t("error.digest-label")} {error.digest}
					</p>
				)}
				<div className="mt-5 flex justify-center gap-3">
					<button
						onClick={reset}
						data-primary
						data-action-button data-variant="primary" className="cursor-pointer border-none px-6 py-2.5 text-sm"
					>
						{t("common.retry")}
					</button>
					<NextLink
						href="/"
						className="inline-flex items-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-6 py-2.5 text-sm text-[var(--text-secondary)] no-underline hover:bg-[var(--surface-hover)]"
					>
						{t("error.back-home")}
					</NextLink>
				</div>
			</div>
		</div>
	);
}
