"use client";

import Link from "next/link";
import { useState, useCallback, useEffect } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { buildQuickServiceAccessDescriptor } from "@/lib/quick-service/access-url";
import { EmptyState } from "@/components/page-shell";
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
import { CATEGORY_ORDER, QUICK_SERVICE_PUBLIC_HOST, RECOMMENDED_SERVICE_SLUGS, buildCategoryLabels, getEnvCount, getPrimaryContainerPort, getVolumeMounts, sortByPriority, type AppSource, type CatalogItem, type DockerEnvironmentStatus, type Tab } from "./quick-services-shared";

/* ── Main Component ─────────────────────────────────────────────── */

export function QuickServicesClient({ canManage }: { canManage: boolean }) {
	const { t } = useI18n();
	const categoryLabels = buildCategoryLabels(t);
	const [catalog, setCatalog] = useState<CatalogItem[]>([]);
	const [remoteCatalog, setRemoteCatalog] = useState<CatalogItem[]>([]);
	const [sources, setSources] = useState<AppSource[]>([]);
	const [usedPorts, setUsedPorts] = useState<number[]>([]);
	const [dockerStatus, setDockerStatus] = useState<DockerEnvironmentStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("community");
	// Install dialog state (the dialog body ships in <InstallDialog />)
	const [installDialog, setInstallDialog] = useState<CatalogItem | null>(null);
	const [configPreview, setConfigPreview] = useState<ConfigPreview<CatalogItem> | null>(null);
	const [pendingUninstall, setPendingUninstall] = useState<{ slug: string; name: string; deleteVolumes: boolean } | null>(null);
	const [pendingSourceDelete, setPendingSourceDelete] = useState<{ id: string; displayName: string } | null>(null);
	// Sync state is owned by useQuickServiceActions (see use-quick-service-actions.ts)
	// Search
	const [search, setSearch] = useState("");
	const [hostName, setHostName] = useState("");
	const [quickServicePublicHost, setQuickServicePublicHost] = useState(QUICK_SERVICE_PUBLIC_HOST);

	const fetchCatalog = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/quick-services");
			setCatalog(data.catalog ?? []);
			setRemoteCatalog(data.remoteCatalog ?? []);
			setUsedPorts(Array.isArray(data.usedPorts) ? data.usedPorts : []);
			setDockerStatus(data.docker ?? null);
			if (typeof data.publicHost === "string") setQuickServicePublicHost(data.publicHost);
		} catch (err) {
			setError(err instanceof Error ? err.message : t("qsPage.loadFailedFallback"));
		} finally {
			setLoading(false);
		}
	}, [t]);

	const fetchSources = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/app-sources?includeApps=false");
			setSources(data.sources ?? []);
		} catch {
			// silent
		}
	}, []);

	// Action handlers + message + actionSlug + syncing now live in the
	// useQuickServiceActions hook (extracted in R23).
	const actions = useQuickServiceActions({ fetchCatalog, fetchSources });

	useEffect(() => { fetchCatalog(); fetchSources(); }, [fetchCatalog, fetchSources]);
	useEffect(() => {
		if (typeof window !== "undefined") {
			setHostName(window.location.hostname);
		}
	}, []);

	// Poll installing services
	useEffect(() => {
		const allCatalog = [...catalog, ...remoteCatalog];
		const installing = allCatalog.filter((s) => s.status === "installing");
		if (installing.length === 0) return;
		const t = setTimeout(fetchCatalog, 3000);
		return () => clearTimeout(t);
	}, [catalog, remoteCatalog, fetchCatalog]);

	const openInstallDialog = (item: CatalogItem) => {
		if (dockerStatus && !dockerStatus.available) {
			actions.showMessage({
				type: "err",
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
			actions.showMessage({ type: "err", text: t("qsPage.installConfigMissing") });
			return;
		}
		setConfigPreview({ action: "install", item, port: input.port });
	};

	const requestUpdate = (item: CatalogItem) => {
		setConfigPreview({ action: "update", item, port: item.port ?? item.defaultPort });
	};

	const confirmConfigPreview = () => {
		if (!configPreview) return;
		if (configPreview.action === "install") {
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
		actions.doAction(target.slug, "update");
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

	if (loading) return <div className="text-sm text-[var(--text-muted)] py-12 text-center">{t("qsPage.loading")}</div>;
	if (error) return <div className="text-sm text-[var(--danger)] py-12 text-center">{error}</div>;

	if (!canManage) {
		return (
			<div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)]/[0.04] p-12 text-center">
				<div className="text-4xl mb-3">🔒</div>
				<p className="text-sm text-[var(--text-muted)]">{t("qsPage.permissionDenied")}</p>
			</div>
		);
	}

	const allItems = [...catalog, ...remoteCatalog];
	const installed = allItems.filter((s) => s.status !== "available");
	const localAvailable = catalog.filter((s) => s.status === "available");
	const remoteAvailable = remoteCatalog.filter((s) => s.status === "available");

	const summary = {
		running: allItems.filter((s) => s.status === "running").length,
		stopped: allItems.filter((s) => s.status === "stopped").length,
		error: allItems.filter((s) => s.status === "error").length,
		available: localAvailable.length + remoteAvailable.length,
	};

	const filterBySearch = (items: CatalogItem[]) => {
		if (!search.trim()) return items;
		const q = search.toLowerCase();
		return items.filter(
			(i) =>
				i.name.toLowerCase().includes(q) ||
				i.description.toLowerCase().includes(q) ||
				i.category.toLowerCase().includes(q) ||
				i.image.toLowerCase().includes(q)
		);
	};

	// Group by category
	const groupByCategory = (items: CatalogItem[]) => {
		const grouped: Record<string, CatalogItem[]> = {};
		for (const cat of CATEGORY_ORDER) grouped[cat] = [];
		for (const item of items) {
			const cat = CATEGORY_ORDER.includes(item.category) ? item.category : "other";
			grouped[cat]!.push(item);
		}
		return grouped;
	};

	const currentItems = tab === "store"
		? sortByPriority(filterBySearch(localAvailable))
		: tab === "community"
			? sortByPriority(filterBySearch(remoteAvailable))
			: sortByPriority(filterBySearch(installed));
	const grouped = groupByCategory(currentItems);
	const recommendedItems = RECOMMENDED_SERVICE_SLUGS
		.map((slug) => catalog.find((item) => item.slug === slug) ?? remoteCatalog.find((item) => item.slug === slug))
		.filter((item): item is CatalogItem => Boolean(item));
	const runningItems = installed.filter((item) => item.status === "running");
	const errorItems = installed.filter((item) => item.status === "error");
	const quickServiceAccess = (item: CatalogItem) => buildQuickServiceAccessDescriptor({
		port: item.port,
		defaultPort: item.defaultPort,
		browserHost: hostName,
		configuredHost: quickServicePublicHost,
		protocol: typeof window !== "undefined" ? window.location.protocol : null,
		path: item.path,
	});
	const accessHostLabel = quickServicePublicHost || hostName || t("qsPage.currentHost");
	const staleSources = sources.filter((source) => source.enabled && source.lastSyncStatus !== "success");
	const lastSyncedSource = sources
		.filter((source) => source.lastSyncAt)
		.sort((a, b) => new Date(b.lastSyncAt ?? 0).getTime() - new Date(a.lastSyncAt ?? 0).getTime())[0];
	const nextAction = errorItems.length > 0
		? { label: t("qsPage.viewErrorServices"), tab: "installed" as Tab, tone: "rose" }
		: runningItems.length > 0
			? { label: t("qsPage.manageRunningServices"), tab: "installed" as Tab, tone: "emerald" }
			: { label: t("qsPage.installRecommendedServices"), tab: "store" as Tab, tone: "cyan" };

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
				<div role={actions.message.type === "ok" ? "status" : "alert"} className={`rounded-lg px-4 py-3 text-sm ${actions.message.type === "ok" ? "bg-[var(--success)]/[0.10] border border-[var(--success-border)] text-[var(--success)]" : "bg-[var(--danger)]/[0.10] border border-[var(--danger-border)] text-[var(--danger)]"}`}>
					<span>{actions.message.text}</span>
					{actions.message.taskId ? (
						<Link href="/operation-tasks" className="ml-3 inline-flex rounded-lg border border-current/30 px-2 py-1 text-xs font-semibold hover:bg-[var(--surface)]/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
							{t("qsPage.viewTaskCenter")}
						</Link>
					) : null}
				</div>
			)}

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<SummaryPill label={t("qsPage.summaryRunning")} value={summary.running} tone="emerald" />
				<SummaryPill label={t("qsPage.summaryStopped")} value={summary.stopped} tone="amber" />
				<SummaryPill label={t("qsPage.summaryError")} value={summary.error} tone="rose" />
				<SummaryPill label={t("qsPage.summaryAvailable")} value={summary.available} tone="cyan" />
			</div>

			<section className="grid gap-3 lg:grid-cols-3">
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.025] p-4">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qsPage.runningOverview")}</p>
							<h2 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{runningItems.length > 0 ? t("qsPage.runningOnlineCount").replace("{count}", String(runningItems.length)) : t("qsPage.noRunningServicesYet")}</h2>
							</div>
							<button type="button" onClick={() => setTab(nextAction.tab)}
							data-tone={nextAction.tone === "rose" ? "rose" : nextAction.tone === "emerald" ? "emerald" : "cyan"}
							className={`rounded-full border px-3 py-1.5 text-xs transition ${nextAction.tone === "rose" ? "border-[var(--danger-border)] text-[var(--danger)] hover:bg-[var(--danger-bg)]" : nextAction.tone === "emerald" ? "border-[var(--success-border)] text-[var(--success)] hover:bg-[var(--success-bg)]" : "border-[var(--accent-border)] text-[var(--accent)] hover:bg-[var(--accent-bg)]"}`}
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
								<a key={item.slug} href={access.url} target="_blank" rel="noreferrer" aria-label={t("qsPage.accessEntry").replace("{name}", item.name).replace("{label}", access.label)} data-tone="emerald" className="rounded-xl border border-[var(--success-border)] p-3 transition hover:bg-[var(--success)]/[0.1]">
									{cardBody}
								</a>
							);
						})}
						{runningItems.length === 0 && <p className="text-sm text-[var(--text-muted)]">{t("qsPage.recommendedHint")}</p>}
					</div>
				</div>
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.025] p-4">
					<p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qsPage.portsLabel")}</p>
					<h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{t("qsPage.listeningPortsCount").replace("{count}", String(usedPorts.length))}</h3>
					<p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t("qsPage.portsHint")}</p>
					<div className="mt-3 flex flex-wrap gap-1.5">
						{usedPorts.slice(0, 8).map((port) => <span key={port} className="rounded-lg border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{port}</span>)}
					</div>
				</div>
				<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.025] p-4">
					<p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qsPage.sourcesLabel")}</p>
					<h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{t("qsPage.sourcesEnabledCount").replace("{enabled}", String(sources.filter((s) => s.enabled).length)).replace("{total}", String(sources.length))}</h3>
					<p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{lastSyncedSource ? t("qsPage.lastSynced").replace("{name}", lastSyncedSource.displayName) : t("qsPage.noSyncRecord")}</p>
					<button type="button" onClick={() => setTab("sources")} className={`mt-3 rounded-lg border px-3 py-1.5 text-xs transition ${staleSources.length > 0 ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)] hover:bg-[var(--warning-bg)]" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10]"}`}>
						{staleSources.length > 0 ? t("qsPage.handleStaleSources").replace("{count}", String(staleSources.length)) : t("qsPage.manageSources")}
					</button>
				</div>
			</section>

			{/* Search bar */}
			<div className="space-y-1.5">
				<label htmlFor="quick-service-search" className="block text-xs font-medium text-[var(--text-muted)]">
					{t("qsPage.searchLabel")}
				</label>
				<div className="relative">
					<input
						id="quick-service-search"
						type="search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder={t("qsPage.searchPlaceholder")}
						data-card className="w-full  px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-slate-500 outline-none focus:border-[var(--color-action-border)]/40 transition"
					/>
					{search && (
						<button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:text-[var(--text-primary)] text-xs">
							✕
						</button>
					)}
				</div>
			</div>

			{tab === "store" && !search && recommendedItems.length > 0 && (
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
								onStart={() => actions.doAction(item.slug, "start")}
								onStop={() => actions.doAction(item.slug, "stop")}
								onUpdate={() => requestUpdate(item)}
								onSync={() => actions.doAction(item.slug, "sync")}
								onUninstall={() => requestUninstall(item)}
								publicHost={quickServicePublicHost}
							/>
						))}
					</div>
				</section>
			)}

			{/* Tab bar */}
			<div data-card className="flex flex-wrap gap-1  p-1 w-fit">
				<button onClick={() => setTab("store")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "store" ? "bg-[var(--color-action)]/20 text-[var(--color-action)] light:bg-[var(--color-action-bg)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:bg-[var(--surface)] light:hover:text-[var(--text-primary)]"}`}>
					{t("qsPage.tabStore").replace("{count}", String(localAvailable.length))}
				</button>
				<button onClick={() => setTab("community")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "community" ? "bg-[var(--accent-bg)] text-[var(--accent)] bg-[var(--accent-bg)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:bg-[var(--surface)] light:hover:text-[var(--text-primary)]"}`}>
					{t("qsPage.tabCommunity").replace("{count}", String(remoteAvailable.length))}
				</button>
				<button onClick={() => setTab("installed")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "installed" ? "bg-[var(--color-action)]/20 text-[var(--color-action)] light:bg-[var(--color-action-bg)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:bg-[var(--surface)] light:hover:text-[var(--text-primary)]"}`}>
					{t("qsPage.tabInstalled").replace("{count}", String(installed.length))}
				</button>
				<button onClick={() => setTab("sources")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "sources" ? "bg-[var(--warning-bg)] text-[var(--warning)] light:bg-[var(--warning)]" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:bg-[var(--surface)] light:hover:text-[var(--text-primary)]"}`}>
					{t("qsPage.tabSources").replace("{count}", String(sources.length))}
				</button>
			</div>
			{/* Sources management tab (extracted to <SourcesPanel /> in TR-036 T37) */}
			{tab === "sources" && (
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
			{tab !== "sources" && CATEGORY_ORDER.map((cat) => {
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
									tab={tab === "community" ? "store" : tab}
									busy={actions.actionSlug === item.slug}
									onInstall={() => openInstallDialog(item)}
									onStart={() => actions.doAction(item.slug, "start")}
									onStop={() => actions.doAction(item.slug, "stop")}
									onUpdate={() => requestUpdate(item)}
									onSync={() => actions.doAction(item.slug, "sync")}
									onUninstall={() => requestUninstall(item)}
									publicHost={quickServicePublicHost}
								/>
							))}
						</div>
					</div>
				);
			})}

			{tab === "installed" && installed.length === 0 && (
				<EmptyState icon="📦" variant="boxed">
					{t("qsPage.emptyInstalled")}
				</EmptyState>
			)}
			{tab === "store" && localAvailable.length === 0 && (
				<EmptyState icon="✅" variant="boxed">
					{t("qsPage.emptyStore")}
				</EmptyState>
			)}
			{tab === "community" && remoteAvailable.length === 0 && (
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

function SummaryPill({ label, value, tone }: { label: string; value: number; tone: "emerald" | "amber" | "rose" | "cyan" }) {
	const toneClass = {
		emerald: "border-[var(--success-border)] bg-[var(--success)]/[0.10] text-[var(--success)]",
		amber: "border-[var(--warning-border)] bg-[var(--warning)]/[0.10] text-[var(--warning)]",
		rose: "border-[var(--danger-border)] bg-[var(--danger)]/[0.10] text-[var(--danger)]",
		cyan: "border-[var(--color-action-border)]/20 bg-[var(--color-action)]/[0.10] text-[var(--text-secondary)]",
	}[tone];

	return (
		<div className={`rounded-xl border p-4 ${toneClass}`}>
			<div className="text-[11px] uppercase tracking-wider text-current/70">{label}</div>
			<div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
		</div>
	);
}
