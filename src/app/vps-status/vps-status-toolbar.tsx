"use client";

/**
 * Toolbar (filter tabs, view-mode switch, refresh controls) for the VPS
 * fleet status page. Extracted 1:1 from `vps-status-client.tsx`.
 */


import { ActionButton, ButtonLink } from "@/components/action-button";
import { Toolbar, ToggleChip } from "@/components/page-shell";
import { StatusBadge } from "@/components/status-badge";

import type { VpsStatusFilter, VpsStatusViewMode } from "./use-vps-status-view";
import { ArrowLeft } from "@/components/icons";

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
		<Toolbar className="justify-between">
			<div className="flex flex-wrap items-center gap-2">
				{(
					[
						["all", t("vpsStatusPage.filter.all")],
						["online", t("vpsStatusPage.filter.online")],
						["issue", t("vpsStatusPage.filter.issue")],
					] as const
				).map(([key, label]) => (
                    <ToggleChip key={key} active={filter === key} onClick={() => setFilter(key)}>
                      {label}
                    </ToggleChip>
				))}
				<span className="ml-1 text-xs text-[var(--text-muted)]">
					{tt("vpsStatusPage.showing", { count: filteredCount })}
				</span>
				<div data-tile className="ml-2 inline-flex p-0.5">
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
							className={`min-h-10 rounded-lg px-3 py-2 text-sm font-medium transition ${
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
				<StatusBadge tone="neutral">
					{refreshIntervalSeconds <= 0
						? t("vpsStatusPage.refresh.off")
						: tt("vpsStatusPage.refresh.every", { label: intervalLabel })}
				</StatusBadge>
				<ButtonLink variant="outline" icon={<ArrowLeft aria-hidden />}
					href="/health">
					{t("vpsStatusPage.gotoSystemHealth")}
				</ButtonLink>
				<ActionButton variant="secondary"
					onClick={() => void fetchHealth()}
					disabled={isRefreshing || loading}
					aria-label={t("healthPage.ui.refreshAria")}

					className="inline-flex items-center"
				>
					{isRefreshing || loading ? t("healthPage.ui.refreshing") : t("healthPage.ui.refresh")}
				</ActionButton>
			</div>
		</Toolbar>
	);
}
