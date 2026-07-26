"use client";

/**
 * VPS fleet status — Komari / Nezha-inspired probe dashboard.
 *
 * Metrics come from SSH sampling (password/key), not a host agent.
 * Auto-refresh interval is the shared Settings preference only
 * (`vps-preferences.autoRefreshInterval`) — no local toggle.
 */

import { CapacityForecastPanel } from "@/app/health/capacity-forecast-panel";
import { FleetResourceSummary, SummaryCard } from "@/app/health/health-dashboard-parts";
import { ActionButton } from "@/components/action-button";

import { useVpsStatusView } from "./use-vps-status-view";
import { VpsNodeCard } from "./vps-node-card";
import { VpsStatusTable } from "./vps-status-table";
import { VpsStatusToolbar } from "./vps-status-toolbar";

type Props = { serverCount: number };

export function VpsStatusClient({ serverCount }: Props) {
	const {
		locale,
		t,
		tt,
		browserLocale,
		overview,
		history,
		historyErrors,
		loadError,
		lastRefresh,
		isRefreshing,
		refreshIntervalSeconds,
		fetchHealth,
		expandedServer,
		filter,
		setFilter,
		viewMode,
		setViewModePersist,
		filteredServers,
		toggleExpand,
		loading,
		intervalLabel,
	} = useVpsStatusView();

	if (!overview && loadError) {
		return (
			<div
				data-tone="rose"
				className="rounded-xl border border-[var(--danger-border)] p-4 text-sm text-[var(--danger)]"
				role="alert"
			>
				<div>{loadError}</div>
				<ActionButton variant="danger"
					onClick={() => void fetchHealth()}
					disabled={isRefreshing}
				
					className="!mt-3 !px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
				>
					{isRefreshing ? t("healthPage.ui.retrying") : t("healthPage.ui.retryLoad")}
				</ActionButton>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{loadError ? (
				<div
					role="alert"
					data-tone="rose"
					className="rounded-xl border border-[var(--danger-border)] p-3 text-sm text-[var(--danger)]"
				>
					{loadError}
				</div>
			) : null}

			<section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
				<SummaryCard
					label={t("healthPage.summary.total")}
					value={overview?.total ?? (serverCount > 0 ? serverCount : "—")}
					color="slate"
				/>
				<SummaryCard label={t("healthPage.summary.online")} value={overview?.online ?? "—"} color="emerald" />
				<SummaryCard label={t("healthPage.summary.warning")} value={overview?.warning ?? "—"} color="amber" />
				<SummaryCard label={t("healthPage.summary.critical")} value={overview?.critical ?? "—"} color="rose" />
				<SummaryCard label={t("healthPage.summary.offline")} value={overview?.offline ?? "—"} color="slate" />
			</section>

			{overview && overview.servers.length > 0 ? (
				<FleetResourceSummary overview={overview} t={t} tt={tt} />
			) : null}

			<CapacityForecastPanel />

			<VpsStatusToolbar
				t={t}
				tt={tt}
				filter={filter}
				setFilter={setFilter}
				filteredCount={filteredServers.length}
				viewMode={viewMode}
				setViewModePersist={setViewModePersist}
				lastRefresh={lastRefresh}
				refreshIntervalSeconds={refreshIntervalSeconds}
				intervalLabel={intervalLabel}
				fetchHealth={fetchHealth}
				isRefreshing={isRefreshing}
				loading={loading}
			/>

			{loading ? (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
					{Array.from({ length: Math.min(Math.max(serverCount, 1), 8) }).map((_, i) => (
						<div
							key={i}
							className="h-64 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
						/>
					))}
				</div>
			) : filteredServers.length === 0 ? (
				<div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-muted)]">
					{t("vpsStatusPage.empty")}
				</div>
			) : viewMode === "table" ? (
				<VpsStatusTable servers={filteredServers} browserLocale={browserLocale} t={t} />
			) : (
				<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
					{filteredServers.map((server) => (
						<VpsNodeCard
							key={server.serverId}
							server={server}
							expanded={expandedServer === server.serverId}
							onToggle={() => void toggleExpand(server.serverId)}
							history={history[server.serverId]}
							historyError={historyErrors[server.serverId]}
							locale={locale}
							t={t}
						/>
					))}
				</div>
			)}
		</div>
	);
}
