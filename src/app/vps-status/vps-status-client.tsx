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
import { EmptyState } from "@/components/page-shell";
import { Notice } from "@/components/ui-primitives";

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
			<Notice
				tone="danger"
				action={{
					label: isRefreshing ? t("healthPage.ui.retrying") : t("healthPage.ui.retryLoad"),
					onClick: () => void fetchHealth(),
					disabled: isRefreshing,
				}}
			>
				{loadError}
			</Notice>
		);
	}

	return (
		<div className="space-y-6">
			{loadError ? (
				<Notice tone="danger">{loadError}</Notice>
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
				<div className="space-y-4">
					<div
						role="status"
						aria-live="polite"
						className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3"
					>
						<div className="text-sm font-medium text-[var(--text-primary)]">
							{t("vpsStatusPage.loading.title")}
						</div>
						<div className="mt-1 text-xs text-[var(--text-muted)]">
							{t("vpsStatusPage.loading.description")}
						</div>
					</div>
					<div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-hidden="true">
						{Array.from({ length: Math.min(Math.max(serverCount, 1), 8) }).map((_, i) => (
							<div
								key={i}
								className="h-64 animate-pulse rounded-2xl border border-[var(--border)] bg-[var(--surface)]"
							/>
						))}
					</div>
				</div>
			) : filteredServers.length === 0 ? (
				<EmptyState variant="boxed" text={t("vpsStatusPage.empty")} />
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
