"use client";

import { X } from "@/components/icons";

import Link from "next/link";
import { useState, useMemo } from "react";
import { buildQuickServiceAccessDescriptor } from "@/lib/quick-service/access-url";
import { EmptyState, Toolbar, StatCard, StatGrid } from "@/components/page-shell";
import { Badge, CONTROL_CLASS, InlineLoading, Notice, SegmentedTabs } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import {
  useQuickServiceActions,
  type ConfigPreview,
} from "./use-quick-service-actions";
import {
	PendingUninstallDialogLazy,
	ConfigPreviewDialogLazy,
} from "./quick-services-dialogs-lazy";
import { ServiceCard } from "./quick-service-card";
import { InstallDialog } from "./install-dialog";
import { SourcesPanel } from "./quick-services-sources-panel";
import { CATEGORY_ORDER, buildCategoryLabels, buildQuickServiceViewModel, getEnvCount, getPrimaryContainerPort, getVolumeMounts, type AppSource, type CatalogItem, type Tab } from "./quick-services-shared";
import { useQuickServiceCatalog } from "./use-quick-service-catalog";
import { ActionButton } from "@/components/action-button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { IconBadgeCheck, IconBlocks, IconShield } from "@/components/nav-icons";

/* ── Main Component ─────────────────────────────────────────────── */

export function QuickServicesClient({
	canManage,
	canManageHubHost,
}: {
	canManage: boolean;
	/** Only a platform manager may target the hub host (its Docker socket runs the control plane). */
	canManageHubHost: boolean;
}) {
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
		sourcesError,
		hostName,
		quickServicePublicHost,
		fetchCatalog,
		fetchSources,
	} = useQuickServiceCatalog(t, canManageHubHost);
	const [tab, setTab] = useState<Tab>("store");
	// Install dialog state (the dialog body ships in <InstallDialog />)
	const [installDialog, setInstallDialog] = useState<CatalogItem | null>(null);
	const [configPreview, setConfigPreview] = useState<ConfigPreview<CatalogItem> | null>(null);
	const [pendingUninstall, setPendingUninstall] = useState<{ slug: string; name: string; deleteVolumes: boolean } | null>(null);
	const [pendingSourceDelete, setPendingSourceDelete] = useState<{ id: string; displayName: string } | null>(null);
	// Sync state is owned by useQuickServiceActions (see use-quick-service-actions.ts)
	// Search
	const [search, setSearch] = useState("");
	const [categoryFilter, setCategoryFilter] = useState("all");
	const selectTab = (nextTab: Tab) => {
		setTab(nextTab);
		setCategoryFilter("all");
	};

	// Action handlers + message + actionSlug + syncing now live in the
	// useQuickServiceActions hook (extracted in R23).
	const actions = useQuickServiceActions({ fetchCatalog, fetchSources, selectedServerId });
	const selectedTargetLabel = selectedServerId
		? (servers.find((server) => server.id === selectedServerId)?.name ?? t("qsPage.targetNodeRemote"))
		: t("qsPage.targetHubHost");
	const selectedServerHost = selectedServerId
		? (servers.find((server) => server.id === selectedServerId)?.host ?? "")
		: "";
	const quickServiceAccessHost = selectedServerHost || quickServicePublicHost;
	const quickServiceAccessProtocol = selectedServerHost ? "http:" : undefined;

	const openInstallDialog = (item: CatalogItem) => {
		if (dockerStatus && !dockerStatus.available) {
			actions.showMessage({
				type:"err",
				text: dockerStatus.installHint
					? t("qsPage.dockerMessage", { message: dockerStatus.message ?? "", hint: dockerStatus.installHint })
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
		setConfigPreview({ action:"install", item, port: input.port, targetLabel: selectedTargetLabel });
	};

	const requestUpdate = (item: CatalogItem) => {
		setConfigPreview({ action:"update", item, port: item.port ?? item.defaultPort, targetLabel: selectedTargetLabel });
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
	const categoryCounts = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, grouped[category]?.length ?? 0]));

	if (loading) return <InlineLoading label={t("qsPage.loading")} className="py-12" />;
	if (error) return <Notice tone="danger" action={{ label: t("common.retry"), onClick: () => void fetchCatalog() }}>{error}</Notice>;

	if (!canManage) {
		return <EmptyState text={t("qsPage.permissionDenied")} variant="boxed" icon={<IconShield />} />;
	}

	const quickServiceAccess = (item: CatalogItem) => buildQuickServiceAccessDescriptor({
		port: item.port,
		defaultPort: item.defaultPort,
		browserHost: hostName,
		configuredHost: quickServiceAccessHost,
		protocol: quickServiceAccessProtocol ?? (typeof window !=="undefined" ? window.location.protocol : null),
		path: item.path,
	});
	const accessHostLabel = quickServiceAccessHost || hostName || t("qsPage.currentHost");
	const staleSources = sources.filter((source) => source.enabled && source.lastSyncStatus !=="success");
	const lastSyncedSource = sources
		.filter((source) => source.lastSyncAt)
		.sort((a, b) => new Date(b.lastSyncAt ?? 0).getTime() - new Date(a.lastSyncAt ?? 0).getTime())[0];
	const nextAction = errorItems.length > 0
		? { label: t("qsPage.viewErrorServices"), tab:"installed" as Tab, tone:"rose" }
		: runningItems.length > 0
			? { label: t("qsPage.manageRunningServices"), tab:"installed" as Tab, tone:"emerald" }
			: { label: t("qsPage.installRecommendedServices"), tab:"store" as Tab, tone:"cyan" };
	const renderServiceCard = (item: CatalogItem, cardTab: Tab, keyPrefix = "") => (
		<ServiceCard
			key={`${keyPrefix}${item.slug}`}
			item={item}
			tab={cardTab === "community" ? "store" : cardTab}
			busy={actions.actionSlug === item.slug}
			onInstall={() => openInstallDialog(item)}
			onStart={() => actions.doAction(item.slug, "start")}
			onStop={() => actions.doAction(item.slug, "stop")}
			onUpdate={() => requestUpdate(item)}
			onSync={() => actions.doAction(item.slug, "sync")}
			onUninstall={() => requestUninstall(item)}
			accessHost={quickServiceAccessHost}
			accessProtocol={quickServiceAccessProtocol}
		/>
	);

	return (
		<div className="space-y-6">
			{sourcesError ? <Notice tone="danger" action={{ label: t("common.retry"), onClick: () => void fetchSources() }}>{sourcesError}</Notice> : null}
			{dockerStatus && !dockerStatus.available ? (
				<Notice tone="warning" title={t("qsPage.dockerNotReadyTitle")}>
					<p>{dockerStatus.message}</p>
					{dockerStatus.installHint ? <p data-code-surface="true" className="ui-mono mt-2 rounded-md bg-[var(--surface-subtle)] px-3 py-2 text-xs text-[var(--text-primary)]">{dockerStatus.installHint}</p> : null}
				</Notice>
			) : null}

			{/* Message */}
			{actions.message && (
				<Notice tone={actions.message.type === "ok" ? "success" : "danger"}>
					<span>{actions.message.text}</span>
					{actions.message.taskId ? (
						<Link href="/operation-tasks" className="ml-3 font-semibold underline underline-offset-2">
							{t("qsPage.viewTaskCenter")}
						</Link>
					) : null}
				</Notice>
			)}

			<StatGrid cols={4}>
				<StatCard label={t("qsPage.summaryRunning")} value={String(summary.running)} accent={summary.running > 0} accentColor="emerald" />
				<StatCard label={t("qsPage.summaryStopped")} value={String(summary.stopped)} accent={summary.stopped > 0} accentColor="amber" />
				<StatCard label={t("qsPage.summaryError")} value={String(summary.error)} accent={summary.error > 0} accentColor="rose" />
				<StatCard label={t("qsPage.summaryAvailable")} value={String(summary.available)} accent={summary.available > 0} accentColor="cyan" />
			</StatGrid>

			<div data-card className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p className="text-xs font-medium text-[var(--text-muted)]">{t("qsPage.targetNode")}</p>
					<p className="mt-1 text-sm text-[var(--text-primary)]">{selectedTargetLabel}</p>
					<p className="mt-1 text-xs text-[var(--text-secondary)]">
						{selectedServerId ? t("qsPage.targetNodeRemoteHint") : t("qsPage.targetNodeHubHint")}
					</p>
				</div>
				<select
					value={selectedServerId}
					onChange={(e) => setSelectedServerId(e.target.value)}
					className={`${CONTROL_CLASS} sm:max-w-sm`}
					aria-label={t("qsPage.targetNode")}
				>
					{canManageHubHost && <option value="">{t("qsPage.targetHubHost")}</option>}
					{servers.map((server) => (
						<option key={server.id} value={server.id}>
							{server.name} ({server.host})
						</option>
					))}
				</select>
			</div>

			<section className="grid gap-3 lg:grid-cols-3">
				<div data-tile className="p-4">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-xs text-[var(--text-muted)]">{t("qsPage.runningOverview")}</p>
							<h2 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{runningItems.length > 0 ? t("qsPage.runningOnlineCount", { count: runningItems.length }) : t("qsPage.noRunningServicesYet")}</h2>
							</div>
							<ActionButton
								size="sm"
								variant={nextAction.tone === "rose" ? "danger" : "secondary"}
								onClick={() => selectTab(nextAction.tab)}
							>
								{nextAction.label}
							</ActionButton>
					</div>
					<div className="mt-4 grid gap-2 sm:grid-cols-2">
						{runningItems.slice(0, 4).map((item) => {
							const access = quickServiceAccess(item);
							const cardBody = (
								<>
									<div className="flex items-center justify-between gap-2">
										<span className="truncate text-sm font-medium text-[var(--text-primary)]">{item.icon} {item.name}</span>
										<span className="ui-mono text-xs text-[var(--text-muted)]">:{item.port ?? item.defaultPort}</span>
									</div>
									<p className="mt-1 truncate text-xs text-[var(--text-muted)]">{access?.url ?? `${accessHostLabel}:${item.port ?? item.defaultPort}`}</p>
									{access ? <p className="mt-2 text-xs font-medium text-[var(--accent)]">{access.label}</p> : <p className="mt-2 text-xs font-medium text-[var(--text-muted)]">{t("qsPage.accessEntryUnconfigured", { name: item.name })}</p>}
								</>
							);
							if (!access) {
								return (
									<div key={item.slug} aria-label={t("qsPage.accessEntryUnconfigured", { name: item.name })} data-inset className="p-3 opacity-80">
										{cardBody}
									</div>
								);
							}
							return (
								<a key={item.slug} href={access.url} target="_blank" rel="noreferrer" aria-label={t("qsPage.accessEntry", { name: item.name, label: access.label })} data-inset className="p-3 transition hover:bg-[var(--surface-hover)]">
									{cardBody}
								</a>
							);
						})}
						{runningItems.length === 0 && <p className="text-sm text-[var(--text-muted)]">{t("qsPage.recommendedHint")}</p>}
					</div>
				</div>
				<div data-tile className="p-4">
					<p className="text-xs text-[var(--text-muted)]">{t("qsPage.portsLabel")}</p>
					<h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{t("qsPage.listeningPortsCount", { count: usedPorts.length })}</h3>
					<p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t("qsPage.portsHint")}</p>
					<div className="mt-3 flex flex-wrap gap-1.5">
						{usedPorts.slice(0, 8).map((port) => <Badge key={port}>{port}</Badge>)}
					</div>
				</div>
				<div data-tile className="p-4">
					<p className="text-xs text-[var(--text-muted)]">{t("qsPage.sourcesLabel")}</p>
					<h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{t("qsPage.sourcesEnabledCount", { enabled: sources.filter((s) => s.enabled).length, total: sources.length })}</h3>
					<p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{lastSyncedSource ? t("qsPage.lastSynced", { name: lastSyncedSource.displayName }) : t("qsPage.noSyncRecord")}</p>
					<ActionButton size="sm" variant={staleSources.length > 0 ? "outline" : "secondary"} onClick={() => selectTab("sources")} className="!mt-3">
						{staleSources.length > 0 ? t("qsPage.handleStaleSources", { count: staleSources.length }) : t("qsPage.manageSources")}
					</ActionButton>
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
							<button type="button" aria-label={t("common.clear")} title={t("common.clear")} onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]">
								<X size={16} aria-hidden />
							</button>
						) : null}
					</div>
				</div>
				{tab !== "sources" ? (
					<label className="space-y-1.5 text-xs font-medium text-[var(--text-muted)]">
						<span className="block">{t("qsPage.categoryFilter")}</span>
						<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} className={`${CONTROL_CLASS} min-w-40`}>
							<option value="all">{t("qsPage.categoryAll")}</option>
							{CATEGORY_ORDER.filter((category) => (categoryCounts[category] ?? 0) > 0).map((category) => (
								<option key={category} value={category}>{categoryLabels[category]} ({categoryCounts[category]})</option>
							))}
						</select>
					</label>
				) : null}
			</Toolbar>

			{tab ==="store" && !search && recommendedItems.length > 0 && (
				<section className="space-y-3">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("qsPage.recommendedHeader")}</h2>
							<p className="mt-1 text-xs text-[var(--text-muted)]">{t("qsPage.recommendedSubheader")}</p>
						</div>
						<Badge>{t("qsPage.mvpPriority")}</Badge>
					</div>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{recommendedItems.map((item) => renderServiceCard(item, "store", "recommended-"))}
					</div>
				</section>
			)}


			<SegmentedTabs
				ariaLabel={t("qsPage.title")}
				value={tab}
				onChange={(value) => selectTab(value as Tab)}
				items={[
					{ id:"store", label: t("qsPage.tabStore", { count: localAvailable.length }) },
					{ id:"community", label: t("qsPage.tabCommunity", { count: remoteAvailable.length }) },
					{ id:"installed", label: t("qsPage.tabInstalled", { count: installed.length }) },
					{ id:"sources", label: t("qsPage.tabSources", { count: sources.length }) },
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
			{tab !=="sources" && CATEGORY_ORDER.filter((cat) => categoryFilter === "all" || categoryFilter === cat).map((cat) => {
				const items = grouped[cat]!;
				if (items.length === 0) return null;
				return (
					<div key={cat} className="space-y-3">
						<h2 className="text-sm font-semibold text-[var(--text-primary)]/70 ">{categoryLabels[cat] ?? cat}</h2>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
								{items.map((item) => renderServiceCard(item, tab))}
						</div>
					</div>
				);
			})}

			{tab ==="installed" && installed.length === 0 && (
				<EmptyState icon={<IconBlocks />} variant="boxed">
					{t("qsPage.emptyInstalled")}
				</EmptyState>
			)}
			{tab ==="store" && localAvailable.length === 0 && (
				<EmptyState icon={<IconBadgeCheck />} variant="boxed">
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
				targetLabel={selectedTargetLabel}
				serverId={selectedServerId || undefined}
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
				supportsDataDeletion={!selectedServerId}
				onCancel={() => setPendingUninstall(null)}
				onConfirm={doUninstall}
				onToggleDeleteVolumes={(next) =>
					setPendingUninstall((current) => (current ? { ...current, deleteVolumes: next } : current))
				}
			/>

			{/* Source-delete confirmation — shared ConfirmDialog (was a hand-rolled clone) */}
			<ConfirmDialog
				open={pendingSourceDelete !== null}
				title={t("qsPage.deleteSourceTitle")}
				description={pendingSourceDelete ? t("qsPage.deleteSourceBody", { name: pendingSourceDelete.displayName }) : undefined}
				cancelLabel={t("qsPage.cancel")}
				confirmLabel={t("qsPage.confirmDelete")}
				onCancel={() => setPendingSourceDelete(null)}
				onConfirm={doDeleteSource}
				ariaLabel={t("qsPage.deleteSourceAria")}
			/>
		</div>
	);
}
