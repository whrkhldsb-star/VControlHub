"use client";

import { useEffect } from "react";

import { PermissionDenied } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";
import { createLogger } from "@/lib/logging";

const logger = createLogger("route-error");

type RouteErrorProps = {
	error: Error & { digest?: string };
	reset: () => void;
	title?: string;
	description?: string;
};

export function RouteError({
	error,
	reset,
	title,
	description,
}: RouteErrorProps) {
	const { t } = useI18n();

	useEffect(() => {
		// TR-030 / 56 multi-tenant (Tick 3): ForbiddenError is an expected,
		// permission-driven signal, not a defect. Still log it for audit so
		// cron / smoke pipelines can correlate page hits with denial.
		if (error.name !== "ForbiddenError") {
			logger.error("route error boundary captured error", error);
		}
	}, [error]);

	// Second-line guard for `requirePagePermission()`: render the shared
	// <PermissionDenied /> surface so the user sees a consistent denial
	// state across every route, instead of a generic rose error card.
	if (error.name === "ForbiddenError") {
		return <PermissionDenied />;
	}

	const resolvedTitle = title ?? t("error.title");
	const resolvedDescription = description ?? t("error.routeDescription");
	return (
		<div className="flex min-h-[50vh] flex-col items-center justify-center p-8 text-center">
			<div className="w-full max-w-lg rounded-3xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] p-8 shadow-[var(--shadow-md)] backdrop-blur">
				<div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--danger-bg)] ring-1 ring-[var(--danger-border)]">
					<svg className="h-7 w-7 text-[var(--danger)]" fill="none" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
						<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
					</svg>
				</div>
				<div className="space-y-2">
					<h2 className="text-lg font-semibold text-[var(--text-primary)]">{resolvedTitle}</h2>
					<p className="mx-auto max-w-lg text-sm leading-6 text-[var(--text-secondary)]">{error.message || resolvedDescription}</p>
					{error.digest ? (
						<p className="inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1 text-xs text-[var(--text-muted)]">
							{t("error.digest-label")} {error.digest}
						</p>
					) : null}
				</div>
				<div className="mt-6 flex flex-wrap justify-center gap-2">
					<button
						onClick={reset}
						data-primary
						className="rounded-xl bg-[var(--accent)] px-4 py-2.5 text-sm font-semibold text-[var(--on-accent)] transition-colors hover:bg-[var(--accent-hover)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
					>
						{t("common.retry")}
					</button>
					<button
						onClick={() => {
							if (typeof window !== "undefined") {
								window.location.reload();
							}
						}}
						className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]"
					>
						{t("error.hard-refresh")}
					</button>
					<a
						href="/health"
						className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]"
					>
						{t("error.health-check")}
					</a>
				</div>
			</div>
		</div>
	);
}
