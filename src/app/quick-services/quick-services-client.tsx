"use client";

import Link from "next/link";
import { useState, useMemo } from "react";
import { buildQuickServiceAccessDescriptor } from "@/lib/quick-service/access-url";
import { EmptyState, Toolbar, StatCard, StatGrid } from "@/components/page-shell";
import { CONTROL_CLASS, SegmentedTabs } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import {
  useQuickServiceActions,
  type ConfigPreview,
} from "./use-quick-service-actions";
import {
	PendingSourceDeleteDialogLazy,
	PendingUninstallDialogLazy,
	ConfigPreviewDialogLazy,
} from "./quick-services-dialogs-lazy";
import { ServiceCard } from "./quick-service-card";
import { InstallDialog } from "./install-dialog";
import { SourcesPanel } from "./quick-services-sources-panel";
import { CATEGORY_ORDER, buildCategoryLabels, buildQuickServiceViewModel, getEnvCount, getPrimaryContainerPort, getVolumeMounts, type AppSource, type CatalogItem, type Tab } from "./quick-services-shared";
import { useQuickServiceCatalog } from "./use-quick-service-catalog";

/* ── Main Component ─────────────────────────────────────────────── */

export function QuickServicesClient({ canManage }: { canManage: boolean }) {
	const { t } = useI18n();
	const categoryLabels = buildCategoryLabels(t);
	const {
		catalog,
		remoteCatalog,
		sources,
		usedPorts,
		dockerStatus,
		servers,
		selectedServerId,
		setSelectedServerId,
		loading,
		error,
		hostName,
		quickServicePublicHost,
		fetchCatalog,
		fetchSources,
	} = useQuickServiceCatalog(t);
	const [tab, setTab] = useState<Tab>("community");
	// Install dialog state (the dialog body ships in <InstallDialog />)
	const [installDialog, setInstallDialog] = useState<CatalogItem | null>(null);
	const [configPreview, setConfigPreview] = useState<ConfigPreview<CatalogItem> | null>(null);
	const [pendingUninstall, setPendingUninstall] = useState<{ slug: string; name: string; deleteVolumes: boolean } | null>(null);
	const [pendingSourceDelete, setPendingSourceDelete] = useState<{ id: string; displayName: string } | null>(null);
	// Sync state is owned by useQuickServiceActions (see use-quick-service-actions.ts)
	// Search
	const [search, setSearch] = useState("");

	// Action handlers + message + actionSlug + syncing now live in the
	// useQuickServiceActions hook (extracted in R23).
	const actions = useQuickServiceActions({ fetchCatalog, fetchSources, selectedServerId });

	const openInstallDialog = (item: CatalogItem) => {
		if (dockerStatus && !dockerStatus.available) {
			actions.showMessage({
				type:"err",
				text: dockerStatus.installHint
					? t("qsPage.dockerMessage").replace("{message}", dockerStatus.message ?? "").replace("{hint}", dockerStatus.installHint)
					: (dockerStatus.message ?? t("qsPage.dockerUnavailable")),
			});
			return;
		}
		setInstallDialog(item);
	};

	const closeInstallDialog = () => {
		setInstallDialog(null);
	};

	const advanceInstall = (input: { slug: string; name: string; port: number }) => {
		const item = [...catalog, ...remoteCatalog].find((candidate) => candidate.slug === input.slug);
		if (!item) {
			actions.showMessage({ type:"err", text: t("qsPage.installConfigMissing") });
			return;
		}
		setConfigPreview({ action:"install", item, port: input.port });
	};

	const requestUpdate = (item: CatalogItem) => {
		setConfigPreview({ action:"update", item, port: item.port ?? item.defaultPort });
	};

	const confirmConfigPreview = () => {
		if (!configPreview) return;
		if (configPreview.action ==="install") {
			// Mirror the original doInstall side effects: clear the dialog
			// and the preview state, then run the network call through
			// the hook so actionSlug / message state stay coherent.
			const preview = configPreview;
			setConfigPreview(null);
			closeInstallDialog();
			actions.doInstall(preview);
			return;
		}
		const target = configPreview.item;
		setConfigPreview(null);
		actions.doAction(target.slug,"update");
	};

	const requestUninstall = (item: CatalogItem) => {
		setPendingUninstall({ slug: item.slug, name: item.name, deleteVolumes: false });
	};

	const doUninstall = async () => {
		if (!pendingUninstall) return;
		const target = pendingUninstall;
		setPendingUninstall(null);
		await actions.doUninstall(target);
	};

	const requestDeleteSource = (source: AppSource) => {
		setPendingSourceDelete({ id: source.id, displayName: source.displayName });
	};

	const doDeleteSource = async () => {
		if (!pendingSourceDelete) return;
		const id = pendingSourceDelete.id;
		setPendingSourceDelete(null);
		await actions.doDeleteSource(id);
	};
	const { installed, localAvailable, remoteAvailable, summary, grouped, recommendedItems, runningItems, errorItems } = useMemo(
		() => buildQuickServiceViewModel(catalog, remoteCatalog, tab, search),
		[catalog, remoteCatalog, search, tab],
	);

	if (loading) return <div className="text-sm text-[var(--text-muted)] py-12 text-center">{t("qsPage.loading")}</div>;
	if (error) return <div className="text-sm text-[var(--danger)] py-12 text-center">{error}</div>;

	if (!canManage) {
		return <EmptyState text={t("qsPage.permissionDenied")} variant="boxed" icon="🔒" />;
	}

	const quickServiceAccess = (item: CatalogItem) => buildQuickServiceAccessDescriptor({
		port: item.port,
		defaultPort: item.defaultPort,
		browserHost: hostName,
		configuredHost: quickServicePublicHost,
		protocol: typeof window !=="undefined" ? window.location.protocol : null,
		path: item.path,
	});
	const accessHostLabel = quickServicePublicHost || hostName || t("qsPage.currentHost");
	const staleSources = sources.filter((source) => source.enabled && source.lastSyncStatus !=="success");
	const lastSyncedSource = sources
		.filter((source) => source.lastSyncAt)
		.sort((a, b) => new Date(b.lastSyncAt ?? 0).getTime() - new Date(a.lastSyncAt ?? 0).getTime())[0];
	const nextAction = errorItems.length > 0
		? { label: t("qsPage.viewErrorServices"), tab:"installed" as Tab, tone:"rose" }
		: runningItems.length > 0
			? { label: t("qsPage.manageRunningServices"), tab:"installed" as Tab, tone:"emerald" }
			: { label: t("qsPage.installRecommendedServices"), tab:"store" as Tab, tone:"cyan" };

	return (
		<div className="space-y-6">
			{dockerStatus && !dockerStatus.available ? (
				<div data-tone="amber" className="rounded-2xl border border-[var(--warning-border)] p-4 text-sm text-[var(--warning)]">
					<div className="font-medium">{t("qsPage.dockerNotReadyTitle")}</div>
					<p className="mt-1 text-xs text-[var(--warning)]/75">{dockerStatus.message}</p>
					{dockerStatus.installHint ? <p data-code-surface="true" className="mt-2 rounded-lg border border-[var(--warning-border)] bg-[var(--surface-subtle)] px-3 py-2 font-mono text-xs text-[var(--warning)]">{dockerStatus.installHint}</p> : null}
				</div>
			) : null}

			{/* Message */}
			{actions.message && (
				<div role={actions.message.type ==="ok" ?"status" :"alert"} className={`rounded-lg px-4 py-3 text-sm ${actions.message.type ==="ok" ?"bg-[var(--success-bg)] border border-[var(--success-border)] text-[var(--success)]" :"bg-[var(--danger-bg)] border border-[var(--danger-border)] text-[var(--danger)]"}`}>
					<span>{actions.message.text}</span>
					{actions.message.taskId ? (
						<Link href="/operation-tasks" className="ml-3 inline-flex rounded-lg border border-current/30 px-2 py-1 text-xs font-semibold hover:bg-[var(--surface-subtle)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
							{t("qsPage.viewTaskCenter")}
						</Link>
					) : null}
				</div>
			)}

			<StatGrid cols={4}>
				<StatCard label={t("qsPage.summaryRunning")} value={String(summary.running)} accent={summary.running > 0} accentColor="emerald" />
				<StatCard label={t("qsPage.summaryStopped")} value={String(summary.stopped)} accent={summary.stopped > 0} accentColor="amber" />
				<StatCard label={t("qsPage.summaryError")} value={String(summary.error)} accent={summary.error > 0} accentColor="rose" />
				<StatCard label={t("qsPage.summaryAvailable")} value={String(summary.available)} accent={summary.available > 0} accentColor="cyan" />
			</StatGrid>

			<section className="grid gap-3 lg:grid-cols-3">
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qsPage.runningOverview")}</p>
							<h2 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{runningItems.length > 0 ? t("qsPage.runningOnlineCount").replace("{count}", String(runningItems.length)) : t("qsPage.noRunningServicesYet")}</h2>
							</div>
							<button type="button" onClick={() => setTab(nextAction.tab)}
							data-tone={nextAction.tone ==="rose" ?"rose" : nextAction.tone ==="emerald" ?"emerald" :"cyan"}
							className={`rounded-full border px-3 py-1.5 text-xs transition ${nextAction.tone ==="rose" ?"border-[var(--danger-border)] text-[var(--danger)] hover:bg-[var(--danger-bg)]" : nextAction.tone ==="emerald" ?"border-[var(--success-border)] text-[var(--success)] hover:bg-[var(--success-bg)]" :"border-[var(--accent-border)] text-[var(--accent)] hover:bg-[var(--accent-bg)]"}`}
						>
							{nextAction.label}
						</button>
					</div>
					<div className="mt-4 grid gap-2 sm:grid-cols-2">
						{runningItems.slice(0, 4).map((item) => {
							const access = quickServiceAccess(item);
							const cardBody = (
								<>
									<div className="flex items-center justify-between gap-2">
										<span className="truncate text-sm font-medium text-[var(--text-primary)]">{item.icon} {item.name}</span>
										<span className="text-[10px] text-[var(--success)]">:{item.port ?? item.defaultPort}</span>
									</div>
									<p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{access?.url ?? `${accessHostLabel}:${item.port ?? item.defaultPort}`}</p>
									{access ? <p className="mt-2 text-[10px] font-medium text-[var(--warning)]">{access.label}</p> : <p className="mt-2 text-[10px] font-medium text-[var(--text-muted)]">{t("qsPage.accessEntryUnconfigured").replace("{name}", item.name)}</p>}
								</>
							);
							if (!access) {
								return (
									<div key={item.slug} aria-label={t("qsPage.accessEntryUnconfigured").replace("{name}", item.name)} data-tone="neutral" className="rounded-xl border border-[var(--border)] p-3 opacity-80">
										{cardBody}
									</div>
								);
							}
							return (
								<a key={item.slug} href={access.url} target="_blank" rel="noreferrer" aria-label={t("qsPage.accessEntry").replace("{name}", item.name).replace("{label}", access.label)} data-tone="emerald" className="rounded-xl border border-[var(--success-border)] p-3 transition hover:bg-[var(--success-bg)] hover:text-[var(--success)]/[0.1]">
									{cardBody}
								</a>
							);
						})}
						{runningItems.length === 0 && <p className="text-sm text-[var(--text-muted)]">{t("qsPage.recommendedHint")}</p>}
					</div>
				</div>
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
					<p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qsPage.portsLabel")}</p>
					<h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{t("qsPage.listeningPortsCount").replace("{count}", String(usedPorts.length))}</h3>
					<p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t("qsPage.portsHint")}</p>
					<div className="mt-3 flex flex-wrap gap-1.5">
						{usedPorts.slice(0, 8).map((port) => <span key={port} className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{port}</span>)}
					</div>
				</div>
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
					<p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qsPage.sourcesLabel")}</p>
					<h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{t("qsPage.sourcesEnabledCount").replace("{enabled}", String(sources.filter((s) => s.enabled).length)).replace("{total}", String(sources.length))}</h3>
					<p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{lastSyncedSource ? t("qsPage.lastSynced").replace("{name}", lastSyncedSource.displayName) : t("qsPage.noSyncRecord")}</p>
					<button type="button" onClick={() => setTab("sources")} className={`mt-3 rounded-lg border px-3 py-1.5 text-xs transition ${staleSources.length > 0 ?"border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] hover:bg-[var(--warning-bg)]" :"border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}>
						{staleSources.length > 0 ? t("qsPage.handleStaleSources").replace("{count}", String(staleSources.length)) : t("qsPage.manageSources")}
					</button>
				</div>
			</section>

			<Toolbar className="flex-col items-stretch gap-3 sm:flex-row sm:items-end">
				<div className="min-w-0 flex-1 space-y-1.5">
					<label htmlFor="quick-service-search" className="block text-xs font-medium text-[var(--text-muted)]">
						{t("qsPage.searchLabel")}
					</label>
					<div className="relative">
						<input
							id="quick-service-search"
							type="search"
							data-input
							value={search}
							onChange={(e) => setSearch(e.target.value)}
							placeholder={t("qsPage.searchPlaceholder")}
							className={`${CONTROL_CLASS} pr-9`}
						/>
						{search ? (
							<button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
								✕
							</button>
						) : null}
					</div>
				</div>
			</Toolbar>

			{tab ==="store" && !search && recommendedItems.length > 0 && (
				<section data-tone="cyan" className="space-y-3 rounded-2xl border border-[var(--color-action-border)]/20 p-4">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("qsPage.recommendedHeader")}</h2>
							<p className="mt-1 text-xs text-[var(--text-muted)]">{t("qsPage.recommendedSubheader")}</p>
						</div>
						<span className="rounded-lg border border-[var(--color-action-border)]/20 px-2 py-1 text-[11px] text-[var(--text-secondary)]">{t("qsPage.mvpPriority")}</span>
					</div>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{recommendedItems.map((item) => (
							<ServiceCard
								key={`recommended-${item.slug}`}
								item={item}
								tab="store"
								busy={actions.actionSlug === item.slug}
								onInstall={() => openInstallDialog(item)}
								onStart={() => actions.doAction(item.slug,"start")}
								onStop={() => actions.doAction(item.slug,"stop")}
								onUpdate={() => requestUpdate(item)}
								onSync={() => actions.doAction(item.slug,"sync")}
								onUninstall={() => requestUninstall(item)}
								publicHost={quickServicePublicHost}
							/>
						))}
					</div>
				</section>
			)}


			<div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="text-xs font-medium uppercase tracking-[0.16em] text-[var(--text-muted)]">
						{t("qsPage.targetNode")}
					</p>
					<p className="mt-1 text-xs text-[var(--text-secondary)]">
						{selectedServerId
							? t("qsPage.targetNodeRemoteHint")
							: t("qsPage.targetNodeHubHint")}
					</p>
				</div>
				<select
					value={selectedServerId}
					onChange={(e) => setSelectedServerId(e.target.value)}
					className={`${CONTROL_CLASS} min-w-[16rem]`}
					aria-label={t("qsPage.targetNode")}
				>
					<option value="">{t("qsPage.targetHubHost")}</option>
					{servers.map((server) => (
						<option key={server.id} value={server.id}>
							{server.name} ({server.host})
						</option>
					))}
				</select>
			</div>
			<SegmentedTabs
				ariaLabel={t("qsPage.title")}
				value={tab}
				onChange={(value) => setTab(value as Tab)}
				items={[
					{ id:"store", label: t("qsPage.tabStore").replace("{count}", String(localAvailable.length)) },
					{ id:"community", label: t("qsPage.tabCommunity").replace("{count}", String(remoteAvailable.length)) },
					{ id:"installed", label: t("qsPage.tabInstalled").replace("{count}", String(installed.length)) },
					{ id:"sources", label: t("qsPage.tabSources").replace("{count}", String(sources.length)) },
				]}
			/>
			{/* Sources management tab (extracted to <SourcesPanel /> in TR-036 T37) */}
			{tab ==="sources" && (
				<SourcesPanel
					sources={sources}
					actions={{
						doSync: actions.doSync,
						doToggleSource: actions.doToggleSource,
						doAddSource: actions.doAddSource,
						syncing: actions.syncing,
					}}
					onRequestDeleteSource={requestDeleteSource}
				/>
			)}

			{/* Store / Community / Installed content */}
			{tab !=="sources" && CATEGORY_ORDER.map((cat) => {
				const items = grouped[cat]!;
				if (items.length === 0) return null;
				return (
					<div key={cat} className="space-y-3">
						<h2 className="text-sm font-semibold text-[var(--text-primary)]/70 tracking-wide">{categoryLabels[cat] ?? cat}</h2>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{items.map((item) => (
								<ServiceCard
									key={item.slug}
									item={item}
									tab={tab ==="community" ?"store" : tab}
									busy={actions.actionSlug === item.slug}
									onInstall={() => openInstallDialog(item)}
									onStart={() => actions.doAction(item.slug,"start")}
									onStop={() => actions.doAction(item.slug,"stop")}
									onUpdate={() => requestUpdate(item)}
									onSync={() => actions.doAction(item.slug,"sync")}
									onUninstall={() => requestUninstall(item)}
									publicHost={quickServicePublicHost}
								/>
							))}
						</div>
					</div>
				);
			})}

			{tab ==="installed" && installed.length === 0 && (
				<EmptyState icon="📦" variant="boxed">
					{t("qsPage.emptyInstalled")}
				</EmptyState>
			)}
			{tab ==="store" && localAvailable.length === 0 && (
				<EmptyState icon="✅" variant="boxed">
					{t("qsPage.emptyStore")}
				</EmptyState>
			)}
			{tab ==="community" && remoteAvailable.length === 0 && (
				<EmptyState icon="🌐" variant="boxed">
					{sources.some((s) => s.enabled) ? t("qsPage.emptyCommunityAllInstalled") : t("qsPage.emptyCommunityHint")}
				</EmptyState>
			)}

			{/* Install Dialog (port picker) — extracted to <InstallDialog /> in TR-036 T37 */}
			<InstallDialog
				open={installDialog}
				onClose={closeInstallDialog}
				onAdvance={advanceInstall}
				getEnvCount={getEnvCount}
				getVolumeMounts={getVolumeMounts}
				getPrimaryContainerPort={getPrimaryContainerPort}
			/>

			{/* Install / update config preview — lazy chunk via ConfigPreviewDialogLazy */}
			<ConfigPreviewDialogLazy
				configPreview={configPreview}
				getEnvCount={getEnvCount}
				getVolumeMounts={getVolumeMounts}
				getPrimaryContainerPort={getPrimaryContainerPort}
				onCancel={() => setConfigPreview(null)}
				onConfirm={confirmConfigPreview}
			/>

			<PendingUninstallDialogLazy
				pending={pendingUninstall}
				onCancel={() => setPendingUninstall(null)}
				onConfirm={doUninstall}
				onToggleDeleteVolumes={(next) =>
					setPendingUninstall((current) => (current ? { ...current, deleteVolumes: next } : current))
				}
			/>

			<PendingSourceDeleteDialogLazy
				pending={pendingSourceDelete}
				onCancel={() => setPendingSourceDelete(null)}
				onConfirm={doDeleteSource}
			/>
		</div>
	);
}
