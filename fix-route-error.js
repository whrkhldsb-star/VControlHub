const fs = require('fs');
let code = `
"use client";

import { useEffect } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { PermissionDenied } from "./permission-denied";

export type RouteErrorProps = {
	error: Error & { digest?: string; name?: string };
	reset: () => void;
	title?: string;
	description?: string;
};

export function RouteError({ error, reset, title, description }: RouteErrorProps) {
	const { t } = useI18n();
	useEffect(() => {
		if (error.name !== "ForbiddenError") {
			console.error("[Route Error]", error);
		}
	}, [error]);

	if (error.name === "ForbiddenError") {
		return <PermissionDenied />;
	}

	const resolvedTitle = title ?? t("error.title");
	const resolvedDescription = description ?? t("error.routeDescription");

	return (
		<div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
			<div className="rounded-full bg-[var(--danger)] p-4 ring-1 ring-[var(--danger-border)]">
				<svg className="h-8 w-8 text-[var(--danger)]" fill="none" width="24" height="24" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
				</svg>
			</div>
			<div className="space-y-2">
				<h2 className="text-lg font-semibold text-[var(--text-primary)]">{resolvedTitle}</h2>
				<p className="max-w-lg text-sm leading-6 text-[var(--text-secondary)]">{error.message || resolvedDescription}</p>
				{error.digest ? (
					<p className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-1 text-xs text-[var(--text-muted)]">
						{t("error.digest-label")} {error.digest}
					</p>
				) : null}
			</div>
			<div className="flex flex-wrap justify-center gap-2">
				<button onClick={reset} className="rounded-lg bg-[var(--color-action-strong)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--color-action)] focus:outline-none focus:ring-2 focus:ring-[var(--color-action-ring)]">
					{t("common.retry")}
				</button>
				<button onClick={() => { if (typeof window !== "undefined") { window.location.reload(); } }} className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]">
					{t("error.hard-refresh")}
				</button>
				<a href="/health" className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)]">
					{t("error.health-check")}
				</a>
			</div>
		</div>
	);
}
`;
fs.writeFileSync('/opt/VControlHub/src/components/route-error.tsx', code);
