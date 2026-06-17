"use client";

import { useEffect } from "react";

import { useI18n } from "@/lib/i18n/use-locale";

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
	const resolvedTitle = title ?? t("error.title");
	const resolvedDescription = description ?? t("error.routeDescription");
	useEffect(() => {
		console.error("[Route Error]", error);
	}, [error]);

	return (
		<div className="flex min-h-[40vh] flex-col items-center justify-center gap-4 p-8 text-center">
			<div className="rounded-full bg-rose-500/10 p-4 ring-1 ring-rose-400/15">
				<svg className="h-8 w-8 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
				</svg>
			</div>
			<div className="space-y-2">
				<h2 className="text-lg font-semibold text-white">{resolvedTitle}</h2>
				<p className="max-w-lg text-sm leading-6 text-[var(--text-secondary)]">{error.message || resolvedDescription}</p>
				{error.digest ? (
					<p className="rounded-full border border-[var(--border)] bg-white/[0.03] px-3 py-1 text-xs text-slate-500">
						{t("error.digest-label")} {error.digest}
					</p>
				) : null}
			</div>
			<div className="flex flex-wrap justify-center gap-2">
				<button
					onClick={reset}
					className="rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
				>
					{t("common.retry")}
				</button>
				<button
					onClick={() => {
						if (typeof window !== "undefined") {
							window.location.reload();
						}
					}}
					className="rounded-lg border border-[var(--border)] bg-white/[0.03] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.06]"
				>
					{t("error.hard-refresh")}
				</button>
				<a
					href="/health"
					className="rounded-lg border border-[var(--border)] bg-white/[0.03] px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/[0.06]"
				>
					{t("error.health-check")}
				</a>
			</div>
		</div>
	);
}
