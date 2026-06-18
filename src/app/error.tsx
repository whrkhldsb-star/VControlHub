"use client";

import NextLink from "next/link";
import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { PermissionDenied } from "@/components/page-shell";

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
			console.error("[root-error]", error);
		}
	}, [error]);

	if (error.name === "ForbiddenError") {
		return <PermissionDenied />;
	}

	return (
		<div className="mx-auto max-w-[600px] px-6 py-20 text-center">
			<h2 className="mb-3 text-2xl font-semibold text-white">
				{t("error.title")}
			</h2>
			<p className="mb-2 text-[15px] leading-relaxed text-neutral-400">
				{error.message || t("error.unknown")}
			</p>
			{error.digest && (
				<p className="mb-4 text-[13px] text-neutral-500">
					{t("error.digest-label")} {error.digest}
				</p>
			)}
			<div className="mt-5 flex justify-center gap-3">
				<button
					onClick={reset}
					className="cursor-pointer rounded-lg border-none bg-blue-600 px-6 py-2 text-sm text-white hover:bg-blue-700"
				>
					{t("common.retry")}
				</button>
				<NextLink
					href="/"
					className="inline-flex items-center rounded-lg bg-neutral-800 light:bg-neutral-100 px-6 py-2 text-sm text-neutral-200 no-underline hover:bg-neutral-700 light:hover:bg-neutral-200"
				>
					{t("error.back-home")}
				</NextLink>
			</div>
		</div>
	);
}
