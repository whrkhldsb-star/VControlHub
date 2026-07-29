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

import { PageShell, PageHeader } from "@/components/page-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { FormField, Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { DockerResourcesPanel } from "./docker-resources-panel";
import { DockerContainerList } from "./docker-container-list";
import { DockerRemovalDialog, DockerLogsDialog } from "./docker-dialogs";
import { useDockerPage } from "./use-docker-page";

export default function DockerPage({ initialServers }: { initialServers: { id: string; name: string; host: string }[] }) {
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
	} = useDockerPage(initialServers);

	const refreshLabel = getRefreshIntervalLabel(refreshIntervalSeconds);
	const defaultSocket = t("dockerPage.scope.defaultSocket");
	const defaultWarning = t("dockerPage.scope.warning");
	const socketPath = dockerScope?.socketPath ?? defaultSocket;
	const scopeWarning = dockerScope?.warning ?? defaultWarning;
	const scopeSocketText = t("dockerPage.scope.socket", { path: socketPath });

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader eyebrow={t("dockerPage.eyebrow")} title={t("dockerPage.title")} description={t("dockerPage.desc")} />
			{/* FEAT-P0-2: Server selector for remote Docker management */}
			{serverList.length > 0 && (
				<div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-3">
					<FormField label={t("dockerPage.scope.serverSelect")} htmlFor="docker-server-select" className="min-w-64">
					<select
						id="docker-server-select"
						value={selectedServerId}
						onChange={(e) => setSelectedServerId(e.target.value)}
						className={UI_INPUT}
					>
						<option value="">{t("dockerPage.scope.hubHost")}</option>
						{serverList.map((s) => (
							<option key={s.id} value={s.id}>{s.name} ({s.host})</option>
						))}
					</select>
					</FormField>
					{selectedServerId && (
						<span className="rounded-full border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2.5 py-1 text-[10px] font-medium text-[var(--accent)]">
							{t("dockerPage.scope.remoteActive")}
						</span>
					)}
				</div>
			)}
			<section
				aria-labelledby="docker-scope-title"
				className="mb-4 rounded-2xl border border-[var(--warning-border)] bg-[color-mix(in_srgb,var(--warning-bg)_45%,var(--surface))] p-4 text-sm text-[var(--warning)]"
			>
				<h2 id="docker-scope-title" className="text-sm font-semibold">{t("dockerPage.scope.title")}</h2>
				<p className="mt-1 leading-relaxed">
					{scopeWarning}
				</p>
				<p className="mt-2 text-xs text-[var(--warning)]/80">
					{scopeSocketText}
				</p>
			</section>
			<div data-toolbar className="mb-4 flex flex-wrap items-center gap-2 p-2.5 text-xs text-[var(--text-muted)]">
				<span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-1 font-medium text-[var(--text-secondary)]">{t("dockerPage.toolbar.compose")}</span>
				<span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface)] px-2.5 py-1">{t("dockerPage.toolbar.groupCount", { count: projectCount })}</span>
				<span className="rounded-full border border-[var(--border-subtle)] bg-[var(--surface)] px-2.5 py-1">{t("dockerPage.toolbar.ungroupedCount", { count: ungrouped.length })}</span>
			</div>
			<div className="mb-6 flex flex-wrap items-center gap-2">
				<ActionButton type="button" variant="primary"
					onClick={() => {
						setLoading(true);
						void fetchContainers();
					}} className="!min-h-11 !rounded-xl !px-3 !py-1.5 !text-xs !font-semibold"
				>
					{t("dockerPage.refresh.list")}
				</ActionButton>
				<ActionButton type="button" variant="secondary"
					onClick={() => {
						for (const container of runningContainers) void fetchStats(container.Id);
					}} className="!min-h-11 !rounded-xl !px-3 !py-1.5 !text-xs !font-medium"
				>
					{t("dockerPage.refresh.stats")}
				</ActionButton>
				<ActionButton type="button" variant={statsAutoRefresh ? "success" : "secondary"}
					onClick={() => setStatsAutoRefresh((v) => !v)}
					disabled={refreshIntervalSeconds <= 0 || runningContainers.length === 0}
					className="!min-h-11 !rounded-xl !px-3 !py-1.5 !text-xs !font-medium disabled:cursor-not-allowed disabled:opacity-50"
				>
					{statsAutoRefresh
						? t("dockerPage.autoRefreshOn", { label: refreshLabel })
						: refreshIntervalSeconds <= 0
							? t("dockerPage.autoRefreshOff")
							: t("dockerPage.autoRefreshPaused", { label: refreshLabel })}
				</ActionButton>
			</div>

			{error && <Notice tone="danger" className="mb-4" onDismiss={clearError} dismissLabel={t("common.close")}>{error}</Notice>}
			{projectMessage && <Notice tone="success" className="mb-4" onDismiss={clearProjectMessage} dismissLabel={t("common.close")}>{projectMessage}</Notice>}

			<DockerResourcesPanel serverId={selectedServerId} />

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
