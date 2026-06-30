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

/* ── Types ──────────────────────────────────────────────────────── */

interface CatalogItem {
	slug: string;
	name: string;
	category: string;
	icon: string;
	description: string;
	image: string;
	defaultPort: number;
	internalPort: number | null;
	path: string;
	envKeyCount?: number;
	volumesJson?: Array<{ host: string; container: string }> | null;
	extraPorts?: Array<{ host: number; container: number }> | null;
	status: string;
	id: string | null;
	containerId: string | null;
	port: number | null;
	error: string | null;
	source: string;
	stars?: number;
	monthlyPulls?: number;
}

interface DockerEnvironmentStatus {
	available: boolean;
	running: boolean;
	version: string | null;
	message: string | null;
	installHint: string | null;
}

interface AppSource {
	id: string;
	name: string;
	displayName: string;
	url: string;
	type: string;
	enabled: boolean;
	lastSyncAt: string | null;
	lastSyncStatus: string | null;
	lastSyncError: string | null;
	syncCount: number;
}

const CATEGORY_ORDER = ["storage", "media", "devtools", "notes", "network", "blog", "other"];
const RECOMMENDED_SERVICE_SLUGS = ["alist", "uptime-kuma", "portainer", "vaultwarden", "gitea"];

function buildCategoryLabels(t: (key: string) => string): Record<string, string> {
	return {
		storage: t("qsPage.category.storage"),
		media: t("qsPage.category.media"),
		devtools: t("qsPage.category.devtools"),
		notes: t("qsPage.category.notes"),
		network: t("qsPage.category.network"),
		blog: t("qsPage.category.blog"),
		other: t("qsPage.category.other"),
	};
}

const QUICK_SERVICE_PUBLIC_HOST = process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST ?? "";

type Tab = "store" | "community" | "installed" | "sources";

/**
 * Helper functions accept any item that has the meta fields they need
 * (envKeyCount / volumesJson / internalPort / defaultPort), so they can
 * be passed to the dialog sub-components (InstallDialog / ConfigPreview)
 * which work with narrower shapes.
 */
type ItemWithMeta = {
	envKeyCount?: number | null;
	volumesJson?: Array<{ host: string; container: string }> | null;
	internalPort?: number | null;
	defaultPort: number;
};

function getEnvCount(item: ItemWithMeta): number {
	return item.envKeyCount ?? 0;
}

function getVolumeMounts(item: ItemWithMeta): Array<{ host: string; container: string }> {
	return item.volumesJson ?? [];
}

function getPrimaryContainerPort(item: ItemWithMeta): number {
	return item.internalPort ?? item.defaultPort;
}

function sortByPriority(items: CatalogItem[]): CatalogItem[] {
	return [...items].sort((a, b) => {
		const rank = (item: CatalogItem) => {
			if (item.status === "error") return 0;
			if (item.status === "installing") return 1;
			if (item.status === "stopped") return 2;
			if (item.status === "running") return 3;
			return 4;
		};
		const rankDiff = rank(a) - rank(b);
		if (rankDiff !== 0) return rankDiff;
		const activityA = (a.monthlyPulls ?? 0) + (a.stars ?? 0);
		const activityB = (b.monthlyPulls ?? 0) + (b.stars ?? 0);
		if (activityA !== activityB) return activityB - activityA;
		return a.name.localeCompare(b.name, "zh-Hans-CN");
	});
}

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
	if (error) return <div className="text-sm text-rose-400 py-12 text-center">{error}</div>;

	if (!canManage) {
		return (
			<div className="rounded-xl border border-dashed border-[var(--border)] bg-white/[0.02] p-12 text-center">
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
				<div data-tone="amber" className="rounded-2xl border border-amber-400/25 p-4 text-sm text-amber-100">
					<div className="font-medium">{t("qsPage.dockerNotReadyTitle")}</div>
					<p className="mt-1 text-xs text-amber-100/75">{dockerStatus.message}</p>
					{dockerStatus.installHint ? <p data-code-surface="true" className="mt-2 rounded-lg border border-amber-300/20 bg-[var(--surface-subtle)] px-3 py-2 font-mono text-xs text-amber-50">{dockerStatus.installHint}</p> : null}
				</div>
			) : null}

			{/* Message */}
			{actions.message && (
				<div role={actions.message.type === "ok" ? "status" : "alert"} className={`rounded-lg px-4 py-3 text-sm ${actions.message.type === "ok" ? "bg-emerald-500/[0.08] border border-emerald-400/20 text-emerald-200" : "bg-rose-500/[0.08] border border-rose-400/20 text-rose-200"}`}>
					<span>{actions.message.text}</span>
					{actions.message.taskId ? (
						<Link href="/operation-tasks" className="ml-3 inline-flex rounded-lg border border-current/30 px-2 py-1 text-xs font-semibold hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
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
				<div className="rounded-2xl border border-[var(--border)] bg-white/[0.025] p-4">
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
							return (
								<a key={item.slug} href={access?.url ?? "#"} target="_blank" rel="noreferrer" aria-disabled={!access} aria-label={access ? t("qsPage.accessEntry").replace("{name}", item.name).replace("{label}", access.label) : t("qsPage.accessEntryUnconfigured").replace("{name}", item.name)} data-tone="emerald" className="rounded-xl border border-emerald-400/15 p-3 transition hover:bg-emerald-400/[0.1]">
									<div className="flex items-center justify-between gap-2">
										<span className="truncate text-sm font-medium text-[var(--text-primary)]">{item.icon} {item.name}</span>
										<span className="text-[10px] text-emerald-200">:{item.port ?? item.defaultPort}</span>
									</div>
									<p className="mt-1 truncate text-[11px] text-[var(--text-muted)]">{access?.url ?? `${accessHostLabel}:${item.port ?? item.defaultPort}`}</p>
									{access ? <p className="mt-2 text-[10px] font-medium text-amber-200">{access.label}</p> : null}
								</a>
							);
						})}
						{runningItems.length === 0 && <p className="text-sm text-[var(--text-muted)]">{t("qsPage.recommendedHint")}</p>}
					</div>
				</div>
				<div className="rounded-2xl border border-[var(--border)] bg-white/[0.025] p-4">
					<p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qsPage.portsLabel")}</p>
					<h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{t("qsPage.listeningPortsCount").replace("{count}", String(usedPorts.length))}</h3>
					<p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{t("qsPage.portsHint")}</p>
					<div className="mt-3 flex flex-wrap gap-1.5">
						{usedPorts.slice(0, 8).map((port) => <span key={port} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[10px] text-[var(--text-muted)]">{port}</span>)}
					</div>
				</div>
				<div className="rounded-2xl border border-[var(--border)] bg-white/[0.025] p-4">
					<p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("qsPage.sourcesLabel")}</p>
					<h3 className="mt-1 text-base font-semibold text-[var(--text-primary)]">{t("qsPage.sourcesEnabledCount").replace("{enabled}", String(sources.filter((s) => s.enabled).length)).replace("{total}", String(sources.length))}</h3>
					<p className="mt-2 text-sm leading-6 text-[var(--text-muted)]">{lastSyncedSource ? t("qsPage.lastSynced").replace("{name}", lastSyncedSource.displayName) : t("qsPage.noSyncRecord")}</p>
					<button type="button" onClick={() => setTab("sources")} className={`mt-3 rounded-lg border px-3 py-1.5 text-xs transition ${staleSources.length > 0 ? "border-amber-400/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-white/[0.06]"}`}>
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
						data-card className="w-full  px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder-slate-500 outline-none focus:border-cyan-400/40 transition"
					/>
					{search && (
						<button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:text-slate-900 text-xs">
							✕
						</button>
					)}
				</div>
			</div>

			{tab === "store" && !search && recommendedItems.length > 0 && (
				<section data-tone="cyan" className="space-y-3 rounded-2xl border border-cyan-400/20 p-4">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("qsPage.recommendedHeader")}</h2>
							<p className="mt-1 text-xs text-[var(--text-muted)]">{t("qsPage.recommendedSubheader")}</p>
						</div>
						<span className="rounded-full border border-cyan-400/20 px-2 py-1 text-[11px] text-cyan-200">{t("qsPage.mvpPriority")}</span>
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
				<button onClick={() => setTab("store")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "store" ? "bg-cyan-500/20 text-cyan-300 light:bg-cyan-100" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:bg-slate-100 light:hover:text-slate-900"}`}>
					{t("qsPage.tabStore").replace("{count}", String(localAvailable.length))}
				</button>
				<button onClick={() => setTab("community")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "community" ? "bg-violet-500/20 text-violet-300 light:bg-violet-100" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:bg-slate-100 light:hover:text-slate-900"}`}>
					{t("qsPage.tabCommunity").replace("{count}", String(remoteAvailable.length))}
				</button>
				<button onClick={() => setTab("installed")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "installed" ? "bg-cyan-500/20 text-cyan-300 light:bg-cyan-100" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:bg-slate-100 light:hover:text-slate-900"}`}>
					{t("qsPage.tabInstalled").replace("{count}", String(installed.length))}
				</button>
				<button onClick={() => setTab("sources")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "sources" ? "bg-amber-500/20 text-amber-300 light:bg-amber-100" : "text-[var(--text-muted)] hover:text-[var(--text-primary)] light:hover:bg-slate-100 light:hover:text-slate-900"}`}>
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
						<h2 className="text-sm font-semibold text-white/70 tracking-wide">{categoryLabels[cat] ?? cat}</h2>
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
		emerald: "border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-200",
		amber: "border-amber-400/20 bg-amber-500/[0.06] text-amber-200",
		rose: "border-rose-400/20 bg-rose-500/[0.06] text-rose-200",
		cyan: "border-cyan-400/20 bg-cyan-500/[0.06] text-cyan-200",
	}[tone];

	return (
		<div className={`rounded-xl border p-4 ${toneClass}`}>
			<div className="text-[11px] uppercase tracking-wider text-current/70">{label}</div>
			<div className="mt-1 text-2xl font-semibold text-[var(--text-primary)]">{value}</div>
		</div>
	);
}
