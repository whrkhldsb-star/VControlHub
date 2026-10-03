"use client";

/**
 * DockerPage — orchestration shell.
 *
 * Split (pure move):
 *   - use-docker-page.ts        → all state + actions + polling effects
 *   - docker-container-card.tsx → single container card (badges, stats, actions)
 *   - docker-container-list.tsx → grouped/ungrouped list + project actions
 *   - docker-dialogs.tsx        → removal confirm dialog + logs dialog
 */

import { RefreshCw } from "@/components/icons";
import { PageShell, PageHeader, Toolbar } from "@/components/page-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { FormField, Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { DockerResourcesPanel } from "./docker-resources-panel";
import { DockerContainerList } from "./docker-container-list";
import { DockerRemovalDialog, DockerLogsDialog } from "./docker-dialogs";
import { useDockerPage } from "./use-docker-page";

export default function DockerPage({
	initialServers,
	canManageHubHost = true,
}: {
	initialServers: { id: string; name: string; host: string }[];
	canManageHubHost?: boolean;
}) {
	const { t } = useI18n();
	const {
		containers,
		loading,
		setLoading,
		error,
		clearError,
		logsId,
		logs,
		actionLoading,
		projectActionLoading,
		projectMessage,
		clearProjectMessage,
		stats,
		statsAutoRefresh,
		setStatsAutoRefresh,
		pendingRemoval,
		pendingProjectDown,
		setPendingProjectDown,
		refreshIntervalSeconds,
		dockerScope,
		serverList,
		selectedServerId,
		setSelectedServerId,
		closeRemovalDialog,
		closeLogsDialog,
		removeCancelButtonRef,
		logsCloseButtonRef,
		grouped,
		ungrouped,
		fetchContainers,
		handleAction,
		requestRemoval,
		confirmRemoval,
		handleProjectAction,
		confirmProjectDown,
		fetchLogs,
		fetchStats,
		runningContainers,
		projectCount,
	} = useDockerPage(initialServers, canManageHubHost);

	const refreshLabel = getRefreshIntervalLabel(refreshIntervalSeconds);
	const defaultSocket = t("dockerPage.scope.defaultSocket");
	const socketPath = dockerScope?.socketPath ?? defaultSocket;
	// The server's scope descriptor carries English-only copy; localize on the
	// client by scope kind so the warning matches the UI language.
	const scopeWarning = !dockerScope || dockerScope.scope === "hub-host"
		? t("dockerPage.scope.warning")
		: t("dockerPage.scope.remoteWarning", { name: dockerScope.serverName ?? "" });
	const scopeSocketText = t("dockerPage.scope.socket", { path: socketPath });

	return (
		<PageShell>
			<PageHeader eyebrow={t("dockerPage.eyebrow")} title={t("dockerPage.title")} description={t("dockerPage.desc")} />
			<Notice tone="warning" className="mb-4" title={<span id="docker-scope-title" role="heading" aria-level={2}>{t("dockerPage.scope.title")}</span>}>
				<p>{scopeWarning}</p>
				<p className="mt-1 text-xs text-[var(--text-muted)]">{scopeSocketText}</p>
			</Notice>

			{/* FEAT-P0-2: target selector (remote Docker management) and list controls share one row. */}
			<Toolbar className="items-end justify-between gap-3">
				<div className="flex min-w-0 flex-wrap items-end gap-3">
					{serverList.length > 0 && (
						<FormField label={t("dockerPage.scope.serverSelect")} htmlFor="docker-server-select" className="min-w-64">
							<select
								id="docker-server-select"
								value={selectedServerId}
								onChange={(e) => setSelectedServerId(e.target.value)}
								className={UI_INPUT}
							>
								{/* The hub host's daemon runs the shared platform; the API refuses
								    it to anyone without platform-manager rights, so do not offer it. */}
								{canManageHubHost && <option value="">{t("dockerPage.scope.hubHost")}</option>}
								{serverList.map((s) => (
									<option key={s.id} value={s.id}>{s.name} ({s.host})</option>
								))}
							</select>
						</FormField>
					)}
					{selectedServerId && <StatusBadge tone="accent">{t("dockerPage.scope.remoteActive")}</StatusBadge>}
					<p className="pb-2 text-xs text-[var(--text-muted)]">
						{t("dockerPage.toolbar.groupCount", { count: projectCount })} · {t("dockerPage.toolbar.ungroupedCount", { count: ungrouped.length })}
					</p>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<ActionButton
						size="sm"
						variant={statsAutoRefresh ? "outline" : "ghost"}
						aria-pressed={statsAutoRefresh}
						onClick={() => setStatsAutoRefresh((v) => !v)}
						disabled={refreshIntervalSeconds <= 0 || runningContainers.length === 0}
					>
						{statsAutoRefresh
							? t("dockerPage.autoRefreshOn", { label: refreshLabel })
							: refreshIntervalSeconds <= 0
								? t("dockerPage.autoRefreshOff")
								: t("dockerPage.autoRefreshPaused", { label: refreshLabel })}
					</ActionButton>
					<ActionButton
						size="sm"
						variant="secondary"
						onClick={() => {
							for (const container of runningContainers) void fetchStats(container.Id);
						}}
					>
						{t("dockerPage.refresh.stats")}
					</ActionButton>
					<ActionButton
						size="sm"
						variant="secondary"
						icon={<RefreshCw size={14} aria-hidden />}
						onClick={() => {
							setLoading(true);
							void fetchContainers();
						}}
					>
						{t("dockerPage.refresh.list")}
					</ActionButton>
				</div>
			</Toolbar>

			{error && <Notice tone="danger" className="mb-4" onDismiss={clearError} dismissLabel={t("common.close")}>{error}</Notice>}
			{projectMessage && <Notice tone="success" className="mb-4" onDismiss={clearProjectMessage} dismissLabel={t("common.close")}>{projectMessage}</Notice>}

			<DockerContainerList
				loading={loading}
				containers={containers}
				grouped={grouped}
				ungrouped={ungrouped}
				t={t}
				stats={stats}
				actionLoading={actionLoading}
				projectActionLoading={projectActionLoading}
				handleAction={handleAction}
				handleProjectAction={handleProjectAction}
				fetchLogs={fetchLogs}
				requestRemoval={requestRemoval}
			/>

			<div className="mt-6">
				<DockerResourcesPanel serverId={selectedServerId} />
			</div>

			<DockerRemovalDialog
				pendingRemoval={pendingRemoval}
				t={t}
				actionLoading={actionLoading}
				removeCancelButtonRef={removeCancelButtonRef}
				closeRemovalDialog={closeRemovalDialog}
				confirmRemoval={confirmRemoval}
			/>

			<ConfirmDialog
				open={pendingProjectDown !== null}
				title={t("dockerPage.project.downTitle")}
				description={t("dockerPage.project.downConfirm", { project: pendingProjectDown ?? "" })}
				cancelLabel={t("common.cancel")}
				confirmLabel={t("dockerPage.project.downConfirmBtn")}
				onCancel={() => setPendingProjectDown(null)}
				onConfirm={() => void confirmProjectDown()}
				busy={pendingProjectDown !== null && projectActionLoading === `${pendingProjectDown}:down`}
			/>

			<DockerLogsDialog
				logsId={logsId}
				logs={logs}
				t={t}
				logsCloseButtonRef={logsCloseButtonRef}
				closeLogsDialog={closeLogsDialog}
			/>
		</PageShell>
	);
}
