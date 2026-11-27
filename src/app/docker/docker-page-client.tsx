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
import { ActionButton, ButtonLink } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { FormField, Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { DockerResourcesPanel } from "./docker-resources-panel";
import { DockerContainerList } from "./docker-container-list";
import { DockerRemovalDialog, DockerLogsDialog } from "./docker-dialogs";
import { getContainerName } from "./docker-helpers";
import { useDockerPage } from "./use-docker-page";

export default function DockerPage({
	initialServers,
	canReadDeployments = false,
	canManageHubHost = true,
}: {
	initialServers: { id: string; name: string; host: string; canInstall?: boolean }[];
	canReadDeployments?: boolean;
	canManageHubHost?: boolean;
}) {
	const { t } = useI18n();
	const {
		containers,
		loading,
		setLoading,
		error,
		listFailed,
		clearError,
		logsId,
		logs,
		actionLoading,
		projectActionLoading,
		dialogError,
		logTail,
		stats,
		statsAutoRefresh,
		setStatsAutoRefresh,
		pendingRemoval,
		pendingProjectDown,
		setPendingProjectDown,
		refreshIntervalSeconds,
		dockerScope,
		invalidTarget,
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

	const refreshLabel = getRefreshIntervalLabel(refreshIntervalSeconds, t);
	const defaultSocket = t("dockerPage.scope.defaultSocket");
	const socketPath = dockerScope?.socketPath ?? defaultSocket;
	// The server's scope descriptor carries English-only copy; localize on the
	// client by scope kind so the warning matches the UI language.
	const scopeWarning = !selectedServerId
		? t("dockerPage.scope.warning")
		: t("dockerPage.scope.remoteWarning", { name: serverList.find(s => s.id === selectedServerId)?.name ?? "" });
	const scopeSocketText = t("dockerPage.scope.socket", { path: socketPath });
	const canInstall = selectedServerId ? initialServers.some(s => s.id === selectedServerId && s.canInstall) : canManageHubHost;

	return (
		<PageShell>
			<PageHeader eyebrow={t("dockerPage.eyebrow")} title={t("dockerPage.title")} description={t("dockerPage.desc")}><ButtonLink href="/quick-services" variant="secondary">{t("qsPage.title")}</ButtonLink></PageHeader>

			{/* FEAT-P0-2: target selector (remote Docker management) and list controls share one row. */}
			<Toolbar className="items-end justify-between gap-3">
				{!invalidTarget && <p className="basis-full text-xs text-[var(--text-muted)]"><span role="heading" aria-level={2}>{t("dockerPage.scope.title")}</span> · {scopeWarning} · {scopeSocketText}</p>}
				<div className="flex min-w-0 flex-wrap items-end gap-3">
					{(serverList.length > 0 || invalidTarget) && (
						<FormField label={t("dockerPage.scope.serverSelect")} htmlFor="docker-server-select" className="min-w-64">
							<select
								id="docker-server-select"
								value={selectedServerId}
								onChange={(e) => setSelectedServerId(e.target.value)}
								className={UI_INPUT}
							>
								{/* The hub host's daemon runs the shared platform; the API refuses
								    it to anyone without platform-manager rights, so do not offer it. */}
								{invalidTarget && <option disabled value={selectedServerId}>{t("dockerPage.invalidTarget")}</option>}
								{canManageHubHost && <option value="">{t("dockerPage.scope.hubHost")}</option>}
								{serverList.map((s) => (
									<option key={s.id} value={s.id}>{s.name} ({s.host})</option>
								))}
							</select>
						</FormField>
					)}
					{selectedServerId && <StatusBadge tone="accent">{t("dockerPage.scope.remoteActive")}</StatusBadge>}
					{/* Counts of a list that did not load would read "0 groups · 0 containers". */}
					{listFailed ? null : (
						<p className="pb-2 text-xs text-[var(--text-muted)]">
							{t("dockerPage.toolbar.groupCount", { count: projectCount })} · {t("dockerPage.toolbar.ungroupedCount", { count: ungrouped.length })}
						</p>
					)}
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
						disabled={!runningContainers.length}
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

			<DockerContainerList
				emptyAction={canInstall ? <ButtonLink href={selectedServerId ? `/quick-services?server=${encodeURIComponent(selectedServerId)}` : "/quick-services"}>{t("dockerPage.browseServices")}</ButtonLink> : canReadDeployments ? <ButtonLink href="/deployments">{t("dockerPage.deployments")}</ButtonLink> : undefined}
				loading={loading}
				listFailed={listFailed}
				failureReason={error}
				onRetry={() => {
					setLoading(true);
					void fetchContainers();
				}}
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

			{/* Without a target (an account with no server to manage) there is nothing to list: the panel would ask
			    for the hub host's networks and volumes, which such an account is refused. A target whose containers
			    could not be read has no networks or volumes to show either: the panel said "no networks". */}
			{(selectedServerId || canManageHubHost) && !invalidTarget && !listFailed ? (
				<div className="mt-6">
					<DockerResourcesPanel serverId={selectedServerId} serverLabel={serverList.find((server) => server.id === selectedServerId)?.name} />
				</div>
			) : null}

			<DockerRemovalDialog
				pendingRemoval={pendingRemoval} error={dialogError}
				t={t}
				actionLoading={actionLoading}
				removeCancelButtonRef={removeCancelButtonRef}
				closeRemovalDialog={closeRemovalDialog}
				confirmRemoval={confirmRemoval}
			/>

			<ConfirmDialog
				open={pendingProjectDown !== null} error={dialogError}
				title={t("dockerPage.project.downTitle")}
				description={t("dockerPage.project.downConfirm", { project: pendingProjectDown ?? "" })}
				cancelLabel={t("common.cancel")}
				confirmLabel={t("dockerPage.project.downConfirmBtn")}
				onCancel={() => setPendingProjectDown(null)}
				onConfirm={() => void confirmProjectDown()}
				busy={pendingProjectDown !== null && projectActionLoading === `${pendingProjectDown}:down`}
			/>

			<DockerLogsDialog
				logsId={logsId} name={containers.filter(c => c.Id === logsId).map(c => getContainerName(t, c))[0]} tail={logTail} fetchLogs={fetchLogs}
				logs={logs}
				t={t}
				logsCloseButtonRef={logsCloseButtonRef}
				closeLogsDialog={closeLogsDialog}
			/>
		</PageShell>
	);
}
