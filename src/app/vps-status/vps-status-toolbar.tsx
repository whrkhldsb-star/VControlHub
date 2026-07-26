"use client";

/**
 * Toolbar (filter tabs, view-mode switch, refresh controls) for the VPS
 * fleet status page. Extracted 1:1 from `vps-status-client.tsx`.
 */

import Link from "next/link";

import { ActionButton } from "@/components/action-button";

import type { VpsStatusFilter, VpsStatusViewMode } from "./use-vps-status-view";

export function VpsStatusToolbar({
	t,
	tt,
	filter,
	setFilter,
	filteredCount,
	viewMode,
	setViewModePersist,
	lastRefresh,
	refreshIntervalSeconds,
	intervalLabel,
	fetchHealth,
	isRefreshing,
	loading,
}: {
	t: (key: string, vars?: Record<string, string | number>) => string;
	tt: (key: string, vars?: Record<string, string | number>) => string;
	filter: VpsStatusFilter;
	setFilter: (filter: VpsStatusFilter) => void;
	filteredCount: number;
	viewMode: VpsStatusViewMode;
	setViewModePersist: (mode: VpsStatusViewMode) => void;
	lastRefresh: string;
	refreshIntervalSeconds: number;
	intervalLabel: string;
	fetchHealth: () => Promise<void>;
	isRefreshing: boolean;
	loading: boolean;
}) {
	return (
		<div className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset] sm:flex-row sm:items-center sm:justify-between">
			<div className="flex flex-wrap items-center gap-2">
				{(
					[
						["all", t("vpsStatusPage.filter.all")],
						["online", t("vpsStatusPage.filter.online")],
						["issue", t("vpsStatusPage.filter.issue")],
					] as const
				).map(([key, label]) => (
					<button
						key={key}
						type="button"
						onClick={() => setFilter(key)}
						className={`rounded-full px-3 py-1 text-xs font-medium transition ${
							filter === key
								? "bg-[var(--color-action)] text-[var(--on-accent,white)]"
								: "bg-[var(--surface-elevated)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
						}`}
					>
						{label}
					</button>
				))}
				<span className="ml-1 text-xs text-[var(--text-muted)]">
					{tt("vpsStatusPage.showing", { count: filteredCount })}
				</span>
				<div className="ml-2 inline-flex rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] p-0.5">
					{(
						[
							["cards", t("vpsStatusPage.view.cards")],
							["table", t("vpsStatusPage.view.table")],
						] as const
					).map(([key, label]) => (
						<button
							key={key}
							type="button"
							onClick={() => setViewModePersist(key)}
							aria-pressed={viewMode === key}
							className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition ${
								viewMode === key
									? "bg-[var(--surface)] text-[var(--text-primary)] shadow-sm"
									: "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
							}`}
						>
							{label}
						</button>
					))}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<span className="text-xs text-[var(--text-muted)]">
					{t("healthPage.ui.lastRefresh")}: {lastRefresh || "—"}
				</span>
				<span className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2.5 py-1 text-[11px] text-[var(--text-secondary)]">
					{refreshIntervalSeconds <= 0
						? t("vpsStatusPage.refresh.off")
						: tt("vpsStatusPage.refresh.every", { label: intervalLabel })}
				</span>
				<Link
					href="/health"
					data-action-button
					data-variant="outline"
					className="!px-3 !text-xs"
				>
					{t("vpsStatusPage.gotoSystemHealth")}
				</Link>
				<ActionButton variant="secondary"
					onClick={() => void fetchHealth()}
					disabled={isRefreshing || loading}
					aria-label={t("healthPage.ui.refreshAria")}
				
					className="inline-flex min-h-11 items-center !px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-60"
				>
					{isRefreshing || loading ? t("healthPage.ui.refreshing") : t("healthPage.ui.refresh")}
				</ActionButton>
			</div>
		</div>
	);
}
