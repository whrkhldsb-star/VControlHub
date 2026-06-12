"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { buildQuickServiceAccessDescriptor } from "@/lib/quick-service/access-url";
import { EmptyState } from "@/components/page-shell";

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

interface QuickServiceActionResult {
	success?: boolean;
	queued?: boolean;
	jobId?: string;
	taskId?: string;
	message?: string;
	status?: string;
	updated?: boolean;
	health?: string | null;
	logTail?: string | null;
}

interface QuickServiceMessage {
	type: "ok" | "err";
	text: string;
	taskId?: string | null;
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

const CATEGORY_LABELS: Record<string, string> = {
	storage: "☁️ 存储网盘",
	media: "🎬 媒体影视",
	devtools: "🔧 开发工具",
	notes: "📝 笔记文档",
	network: "🌐 网络监控",
	blog: "✍️ 博客建站",
	other: "📦 其他服务",
};

const CATEGORY_ORDER = ["storage", "media", "devtools", "notes", "network", "blog", "other"];
const RECOMMENDED_SERVICE_SLUGS = ["alist", "uptime-kuma", "portainer", "vaultwarden", "gitea"];

const SOURCE_PRESETS = [
	{ key: "linuxserver", label: "LinuxServer.io", type: "linuxserver", url: "", description: "媒体、下载、监控类服务。", badge: "LSIO" },
	{ key: "github", label: "GitHub Raw JSON", type: "github", url: "", description: "社区维护的公开 JSON 目录。", badge: "GitHub" },
	{ key: "json", label: "通用 JSON", type: "json", url: "", description: "你自己整理的任意 JSON 目录。", badge: "JSON" },
] as const;

const QUICK_SERVICE_PUBLIC_HOST = process.env.NEXT_PUBLIC_QUICK_SERVICE_PUBLIC_HOST ?? "";

type Tab = "store" | "community" | "installed" | "sources";

type ConfigPreviewAction = "install" | "update";

interface ConfigPreview {
	action: ConfigPreviewAction;
	item: CatalogItem;
	port: number;
}

function getEnvCount(item: CatalogItem): number {
	return item.envKeyCount ?? 0;
}

function getVolumeMounts(item: CatalogItem): Array<{ host: string; container: string }> {
	return item.volumesJson ?? [];
}

function getPrimaryContainerPort(item: CatalogItem): number {
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
	const [catalog, setCatalog] = useState<CatalogItem[]>([]);
	const [remoteCatalog, setRemoteCatalog] = useState<CatalogItem[]>([]);
	const [sources, setSources] = useState<AppSource[]>([]);
	const [usedPorts, setUsedPorts] = useState<number[]>([]);
	const [dockerStatus, setDockerStatus] = useState<DockerEnvironmentStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("community");
	const [actionSlug, setActionSlug] = useState<string | null>(null);
	const [message, setMessage] = useState<QuickServiceMessage | null>(null);
	const [newSourceName, setNewSourceName] = useState("");
	const [newSourceDisplayName, setNewSourceDisplayName] = useState("");
	const [newSourceUrl, setNewSourceUrl] = useState("");
	const [newSourceType, setNewSourceType] = useState<"json" | "github" | "linuxserver">("json");
	const [sourcePreset, setSourcePreset] = useState<(typeof SOURCE_PRESETS)[number]["key"] | null>(null);
	// Install dialog state
	const [installDialog, setInstallDialog] = useState<{ slug: string; name: string; defaultPort: number } | null>(null);
	const [configPreview, setConfigPreview] = useState<ConfigPreview | null>(null);
	const [pendingUninstall, setPendingUninstall] = useState<{ slug: string; name: string; deleteVolumes: boolean } | null>(null);
	const [pendingSourceDelete, setPendingSourceDelete] = useState<{ id: string; displayName: string } | null>(null);
	const [customPort, setCustomPort] = useState<string>("");
	const [portCheck, setPortCheck] = useState<{ available: boolean; usedBy: string | null; checking: boolean } | null>(null);
	// Sync state
	const [syncing, setSyncing] = useState<string | null>(null);
	// Search
	const [search, setSearch] = useState("");
	const [hostName, setHostName] = useState("");
	const [quickServicePublicHost, setQuickServicePublicHost] = useState(QUICK_SERVICE_PUBLIC_HOST);

	const portCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const fetchCatalog = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/quick-services");
			setCatalog(data.catalog ?? []);
			setRemoteCatalog(data.remoteCatalog ?? []);
			setUsedPorts(Array.isArray(data.usedPorts) ? data.usedPorts : []);
			setDockerStatus(data.docker ?? null);
			if (typeof data.publicHost === "string") setQuickServicePublicHost(data.publicHost);
		} catch (err) {
			setError(err instanceof Error ? err.message : "加载失败");
		} finally {
			setLoading(false);
		}
	}, []);

	const fetchSources = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/app-sources?includeApps=false");
			setSources(data.sources ?? []);
		} catch {
			// silent
		}
	}, []);

	useEffect(() => { fetchCatalog(); fetchSources(); }, [fetchCatalog, fetchSources]);
	useEffect(() => {
		if (typeof window !== "undefined") {
			setHostName(window.location.hostname);
		}
	}, []);

	// Auto-dismiss message
	useEffect(() => {
		if (!message) return;
		const t = setTimeout(() => setMessage(null), 4000);
		return () => clearTimeout(t);
	}, [message]);

	// Poll installing services
	useEffect(() => {
		const allCatalog = [...catalog, ...remoteCatalog];
		const installing = allCatalog.filter((s) => s.status === "installing");
		if (installing.length === 0) return;
		const t = setTimeout(fetchCatalog, 3000);
		return () => clearTimeout(t);
	}, [catalog, remoteCatalog, fetchCatalog]);

	// Debounced port availability check
	const checkPortAvailability = useCallback(async (port: number) => {
		setPortCheck({ available: false, usedBy: null, checking: true });
		try {
			const data = await csrfFetch<{ available: boolean; usedBy?: string | null }>(`/api/quick-services/check-port?port=${encodeURIComponent(String(port))}`);
			setPortCheck({ available: data.available, usedBy: data.usedBy ?? null, checking: false });
		} catch (err) {
			setPortCheck({ available: false, usedBy: err instanceof Error ? err.message : "检查失败", checking: false });
		}
	}, []);

	const handlePortInput = useCallback((value: string) => {
		setCustomPort(value);
		if (portCheckTimer.current) clearTimeout(portCheckTimer.current);
		const port = Number(value);
		if (!value || isNaN(port) || port < 1 || port > 65535) {
			setPortCheck(null);
			return;
		}
		portCheckTimer.current = setTimeout(() => {
			checkPortAvailability(port);
		}, 400);
	}, [checkPortAvailability]);

	const openInstallDialog = (item: CatalogItem) => {
		if (dockerStatus && !dockerStatus.available) {
			setMessage({ type: "err", text: dockerStatus.installHint ? `${dockerStatus.message}：${dockerStatus.installHint}` : (dockerStatus.message ?? "Docker 不可用") });
			return;
		}
		setInstallDialog({ slug: item.slug, name: item.name, defaultPort: item.defaultPort });
		setCustomPort(String(item.defaultPort));
		setPortCheck({ available: false, usedBy: null, checking: true });
		checkPortAvailability(item.defaultPort);
	};

	const closeInstallDialog = () => {
		setInstallDialog(null);
		setCustomPort("");
		setPortCheck(null);
		if (portCheckTimer.current) clearTimeout(portCheckTimer.current);
	};

	const requestInstall = () => {
		if (!installDialog) return;
		const port = Number(customPort);
		if (isNaN(port) || port < 1 || port > 65535) {
			setMessage({ type: "err", text: "端口号无效，请输入 1-65535 之间的数字" });
			return;
		}
		if (portCheck && !portCheck.available) {
			setMessage({ type: "err", text: `端口 ${port} 已被占用（${portCheck.usedBy}），请更换端口` });
			return;
		}
		const item = [...catalog, ...remoteCatalog].find((candidate) => candidate.slug === installDialog.slug);
		if (!item) {
			setMessage({ type: "err", text: "未找到待安装服务配置，请刷新后重试" });
			return;
		}
		setConfigPreview({ action: "install", item, port });
	};

	const doInstall = async (preview: ConfigPreview) => {
		setActionSlug(preview.item.slug);
		setConfigPreview(null);
		closeInstallDialog();
		try {
			const data = await csrfFetch<QuickServiceActionResult>("/api/quick-services", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slug: preview.item.slug, customPort: preview.port }),
			});
			setMessage({ type: "ok", text: data.taskId ? `${preview.item.name} 安装已排队（${data.taskId}），可在任务中心查看进度。` : `${preview.item.name} 安装任务已提交，正在拉取镜像…`, taskId: data.taskId });
			setTimeout(fetchCatalog, 1500);
		} catch (err) {
			setMessage({ type: "err", text: err instanceof Error ? err.message : "安装失败" });
		} finally {
			setActionSlug(null);
		}
	};

	const requestUpdate = (item: CatalogItem) => {
		setConfigPreview({ action: "update", item, port: item.port ?? item.defaultPort });
	};

	const confirmConfigPreview = () => {
		if (!configPreview) return;
		if (configPreview.action === "install") {
			doInstall(configPreview);
			return;
		}
		const target = configPreview.item;
		setConfigPreview(null);
		doAction(target.slug, "update");
	};

	const doAction = async (slug: string, action: string) => {
		setActionSlug(slug);
		try {
			const data = await csrfFetch<QuickServiceActionResult>(`/api/quick-services/${slug}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action }),
			});
			const updateDetails = [
				data.health ? `健康状态：${data.health}` : null,
				data.logTail ? `最近日志：${data.logTail.split("\n").slice(-2).join(" / ")}` : null,
			]
				.filter(Boolean)
				.join("；");
			const queuedSuffix = data.taskId ? `（${data.taskId}）` : "";
			const actionMessages: Record<string, string> = data.queued ? {
				start: `启动已排队${queuedSuffix}，可在任务中心查看进度。`,
				stop: `停止已排队${queuedSuffix}，可在任务中心查看进度。`,
				sync: `状态刷新已排队${queuedSuffix}，可在任务中心查看进度。`,
				update: `更新已排队${queuedSuffix}，后台将拉取镜像并重建容器。`,
			} : {
				start: "已启动",
				stop: "已停止",
				sync: data.status === "running" ? "状态已刷新：运行中" : "状态已刷新：已停止",
				update: updateDetails ? `更新完成，已拉取镜像并重建容器；${updateDetails}` : "更新完成，已拉取镜像并重建容器",
			};
			setMessage({ type: "ok", text: actionMessages[action] ?? "操作完成", taskId: data.taskId });
			fetchCatalog();
		} catch (err) {
			setMessage({ type: "err", text: err instanceof Error ? err.message : "操作失败" });
		} finally {
			setActionSlug(null);
		}
	};

	const requestUninstall = (item: CatalogItem) => {
		setPendingUninstall({ slug: item.slug, name: item.name, deleteVolumes: false });
	};

	const doUninstall = async () => {
		if (!pendingUninstall) return;
		const target = pendingUninstall;
		setPendingUninstall(null);
		setActionSlug(target.slug);
		try {
			const data = await csrfFetch<QuickServiceActionResult>(`/api/quick-services/${target.slug}`, {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ deleteVolumes: target.deleteVolumes }),
			});
			const taskLabel = data.taskId ? `（${data.taskId}）` : "";
			setMessage({ type: "ok", text: data.queued ? (target.deleteVolumes ? `卸载并删除数据目录已排队${taskLabel}` : `卸载已排队${taskLabel}，数据目录将保留`) : (target.deleteVolumes ? "已卸载并删除数据目录" : "已卸载，数据目录已保留"), taskId: data.taskId });
			fetchCatalog();
		} catch (err) {
			setMessage({ type: "err", text: err instanceof Error ? err.message : "卸载失败" });
		} finally {
			setActionSlug(null);
		}
	};

	const doSync = async (sourceId?: string) => {
		setSyncing(sourceId ?? "all");
		try {
			await csrfFetch("/api/app-sources", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "sync", sourceId }),
			});
			setMessage({ type: "ok", text: "同步完成，正在刷新应用列表…" });
			await fetchSources();
			await fetchCatalog();
		} catch (err) {
			setMessage({ type: "err", text: err instanceof Error ? err.message : "同步失败" });
		} finally {
			setSyncing(null);
		}
	};

	const doToggleSource = async (sourceId: string, enabled: boolean) => {
		try {
			await csrfFetch("/api/app-sources", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action: "toggle", sourceId, enabled }),
			});
			fetchSources();
			if (!enabled) fetchCatalog(); // refresh catalog when disabling a source
		} catch {
			setMessage({ type: "err", text: "操作失败" });
		}
	};

	const requestDeleteSource = (source: AppSource) => {
		setPendingSourceDelete({ id: source.id, displayName: source.displayName });
	};

	const doDeleteSource = async () => {
		if (!pendingSourceDelete) return;
		try {
			await csrfFetch(`/api/app-sources?sourceId=${pendingSourceDelete.id}`, { method: "DELETE" });
			setPendingSourceDelete(null);
			setMessage({ type: "ok", text: "源已删除" });
			fetchSources();
			fetchCatalog();
		} catch {
			setMessage({ type: "err", text: "删除失败" });
		}
	};

	const applySourcePreset = (key: (typeof SOURCE_PRESETS)[number]["key"]) => {
		const preset = SOURCE_PRESETS.find((item) => item.key === key);
		if (!preset) return;
		setSourcePreset(key);
		setNewSourceType(preset.type);
		setNewSourceDisplayName(preset.label);
		setNewSourceName(preset.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
		setNewSourceUrl(preset.url);
	};

	const doAddSource = async () => {
		if (!newSourceName.trim() || !newSourceDisplayName.trim() || !newSourceUrl.trim()) {
			setMessage({ type: "err", text: "请先填写完整的源信息" });
			return;
		}
		try {
			await csrfFetch("/api/app-sources", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: newSourceName.trim(),
					displayName: newSourceDisplayName.trim(),
					url: newSourceUrl.trim(),
					type: newSourceType,
				}),
			});
			setMessage({ type: "ok", text: "应用源已添加" });
			setNewSourceName("");
			setNewSourceDisplayName("");
			setNewSourceUrl("");
			setSourcePreset(null);
			await fetchSources();
		} catch (err) {
			setMessage({ type: "err", text: err instanceof Error ? err.message : "添加失败" });
		}
	};

	if (loading) return <div className="text-sm text-slate-500 py-12 text-center">加载中…</div>;
	if (error) return <div className="text-sm text-rose-400 py-12 text-center">{error}</div>;

	if (!canManage) {
		return (
			<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
				<div className="text-4xl mb-3">🔒</div>
				<p className="text-sm text-slate-500">当前角色无快捷服务管理权限</p>
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
			grouped[cat].push(item);
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
	const installPreviewItem = installDialog ? allItems.find((item) => item.slug === installDialog.slug) : null;
	const installPreviewContainerPort = installPreviewItem ? getPrimaryContainerPort(installPreviewItem) : installDialog?.defaultPort;
	const installPreviewEnvCount = installPreviewItem ? getEnvCount(installPreviewItem) : 0;
	const installPreviewVolumeCount = installPreviewItem ? getVolumeMounts(installPreviewItem).length : 0;
	const accessHostLabel = quickServicePublicHost || hostName || "当前主机";
	const staleSources = sources.filter((source) => source.enabled && source.lastSyncStatus !== "success");
	const lastSyncedSource = sources
		.filter((source) => source.lastSyncAt)
		.sort((a, b) => new Date(b.lastSyncAt ?? 0).getTime() - new Date(a.lastSyncAt ?? 0).getTime())[0];
	const nextAction = errorItems.length > 0
		? { label: "查看异常服务", tab: "installed" as Tab, tone: "rose" }
		: runningItems.length > 0
			? { label: "管理运行服务", tab: "installed" as Tab, tone: "emerald" }
			: { label: "安装推荐服务", tab: "store" as Tab, tone: "cyan" };

	return (
		<div className="space-y-6">
			{dockerStatus && !dockerStatus.available ? (
				<div className="rounded-2xl border border-amber-400/25 bg-amber-500/[0.08] p-4 text-sm text-amber-100">
					<div className="font-medium">Docker 环境未就绪，快捷服务安装已暂停</div>
					<p className="mt-1 text-xs text-amber-100/75/75">{dockerStatus.message}</p>
					{dockerStatus.installHint ? <p data-code-surface="true" className="mt-2 rounded-lg border border-amber-300/20 bg-slate-950/50 px-3 py-2 font-mono text-xs text-amber-50 light:border-slate-200 light:bg-slate-50">{dockerStatus.installHint}</p> : null}
				</div>
			) : null}

			{/* Message */}
			{message && (
				<div role={message.type === "ok" ? "status" : "alert"} className={`rounded-lg px-4 py-3 text-sm ${message.type === "ok" ? "bg-emerald-500/[0.08] border border-emerald-400/20 text-emerald-200" : "bg-rose-500/[0.08] border border-rose-400/20 text-rose-200"}`}>
					<span>{message.text}</span>
					{message.taskId ? (
						<a href="/operation-tasks" className="ml-3 inline-flex rounded-md border border-current/30 px-2 py-1 text-xs font-semibold hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current">
							查看任务中心
						</a>
					) : null}
				</div>
			)}

			<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
				<SummaryPill label="运行中" value={summary.running} tone="emerald" />
				<SummaryPill label="已停止" value={summary.stopped} tone="amber" />
				<SummaryPill label="异常" value={summary.error} tone="rose" />
				<SummaryPill label="可安装" value={summary.available} tone="cyan" />
			</div>

			<section className="grid gap-3 lg:grid-cols-[1.2fr_0.9fr_0.9fr]">
				<div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 light:border-slate-200 light:bg-white">
					<div className="flex items-start justify-between gap-3">
						<div>
							<p className="text-xs uppercase tracking-[0.2em] text-cyan-300/70">运行概览</p>
							<h2 className="mt-1 text-base font-semibold text-white">{runningItems.length > 0 ? `${runningItems.length} 个服务在线` : "还没有运行中的服务"}</h2>
						</div>
						<button type="button" onClick={() => setTab(nextAction.tab)}
							className={`rounded-full border px-3 py-1.5 text-xs transition ${nextAction.tone === "rose" ? "border-rose-400/30 bg-rose-400/10 text-rose-100 hover:bg-rose-400/15" : nextAction.tone === "emerald" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-100 hover:bg-emerald-400/15" : "border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/15"}`}
						>
							{nextAction.label}
						</button>
					</div>
					<div className="mt-4 grid gap-2 sm:grid-cols-2">
						{runningItems.slice(0, 4).map((item) => {
							const access = quickServiceAccess(item);
							return (
								<a key={item.slug} href={access?.url ?? "#"} target="_blank" rel="noreferrer" aria-disabled={!access} aria-label={access ? `${item.name} 访问入口，${access.label}` : `${item.name} 访问入口未配置`} className="rounded-xl border border-emerald-400/15 bg-emerald-400/[0.06] p-3 transition hover:bg-emerald-400/[0.1]">
									<div className="flex items-center justify-between gap-2">
										<span className="truncate text-sm font-medium text-white">{item.icon} {item.name}</span>
										<span className="text-[10px] text-emerald-200">:{item.port ?? item.defaultPort}</span>
									</div>
									<p className="mt-1 truncate text-[11px] text-slate-400">{access?.url ?? `${accessHostLabel}:${item.port ?? item.defaultPort}`}</p>
									{access ? <p className="mt-2 text-[10px] font-medium text-amber-200">{access.label}</p> : null}
								</a>
							);
						})}
						{runningItems.length === 0 && <p className="text-sm text-slate-500">从推荐服务中安装 AList、Uptime Kuma 或 Portainer 后，这里会出现访问入口。</p>}
					</div>
				</div>
				<div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 light:border-slate-200 light:bg-white">
					<p className="text-xs uppercase tracking-[0.2em] text-slate-500">端口</p>
					<h3 className="mt-1 text-base font-semibold text-white">{usedPorts.length} 个监听端口</h3>
					<p className="mt-2 text-sm leading-6 text-slate-400">安装前会实时检查端口冲突，当前服务端口会优先显示在运行入口里。</p>
					<div className="mt-3 flex flex-wrap gap-1.5">
						{usedPorts.slice(0, 8).map((port) => <span key={port} className="rounded-full border border-white/[0.08] px-2 py-0.5 text-[10px] text-slate-400">{port}</span>)}
					</div>
				</div>
				<div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 light:border-slate-200 light:bg-white">
					<p className="text-xs uppercase tracking-[0.2em] text-slate-500">应用源</p>
					<h3 className="mt-1 text-base font-semibold text-white">{sources.filter((s) => s.enabled).length}/{sources.length} 个源启用</h3>
					<p className="mt-2 text-sm leading-6 text-slate-400">{lastSyncedSource ? `最近同步：${lastSyncedSource.displayName}` : "还没有同步记录。"}</p>
					<button type="button" onClick={() => setTab("sources")} className={`mt-3 rounded-lg border px-3 py-1.5 text-xs transition ${staleSources.length > 0 ? "border-amber-400/30 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15" : "border-white/[0.08] text-slate-300 hover:bg-white/[0.06]"}`}>
						{staleSources.length > 0 ? `处理 ${staleSources.length} 个待同步源` : "管理应用源"}
					</button>
				</div>
			</section>

			{/* Search bar */}
			<div className="space-y-1.5">
				<label htmlFor="quick-service-search" className="block text-xs font-medium text-slate-400">
					搜索快捷服务
				</label>
				<div className="relative">
					<input
						id="quick-service-search"
						type="search"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						placeholder="应用名称、描述、镜像…"
						data-card className="w-full  px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:border-cyan-400/40 transition"
					/>
					{search && (
						<button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white light:hover:text-slate-900 text-xs">
							✕
						</button>
					)}
				</div>
			</div>

			{tab === "store" && !search && recommendedItems.length > 0 && (
				<section className="space-y-3 rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.05] p-4">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h2 className="text-sm font-semibold text-white">推荐快速服务</h2>
							<p className="mt-1 text-xs text-slate-400">优先覆盖文件、监控、容器管理、密码库和代码托管。</p>
						</div>
						<span className="rounded-full border border-cyan-400/20 px-2 py-1 text-[11px] text-cyan-200">MVP 优先</span>
					</div>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{recommendedItems.map((item) => (
							<ServiceCard
								key={`recommended-${item.slug}`}
								item={item}
								tab="store"
								busy={actionSlug === item.slug}
								onInstall={() => openInstallDialog(item)}
								onStart={() => doAction(item.slug, "start")}
								onStop={() => doAction(item.slug, "stop")}
								onUpdate={() => requestUpdate(item)}
								onSync={() => doAction(item.slug, "sync")}
								onUninstall={() => requestUninstall(item)}
								publicHost={quickServicePublicHost}
							/>
						))}
					</div>
				</section>
			)}

			{/* Tab bar */}
			<div data-card className="flex flex-wrap gap-1  p-1 light:border-slate-200 light:bg-white w-fit">
				<button onClick={() => setTab("store")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "store" ? "bg-cyan-500/20 text-cyan-300 light:bg-cyan-100" : "text-slate-400 hover:text-white light:hover:bg-slate-100 light:hover:text-slate-900"}`}>
					🏪 本地精选 ({localAvailable.length})
				</button>
				<button onClick={() => setTab("community")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "community" ? "bg-violet-500/20 text-violet-300 light:bg-violet-100" : "text-slate-400 hover:text-white light:hover:bg-slate-100 light:hover:text-slate-900"}`}>
					🌐 社区推荐 ({remoteAvailable.length})
				</button>
				<button onClick={() => setTab("installed")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "installed" ? "bg-cyan-500/20 text-cyan-300 light:bg-cyan-100" : "text-slate-400 hover:text-white light:hover:bg-slate-100 light:hover:text-slate-900"}`}>
					📦 已安装 ({installed.length})
				</button>
				<button onClick={() => setTab("sources")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "sources" ? "bg-amber-500/20 text-amber-300 light:bg-amber-100" : "text-slate-400 hover:text-white light:hover:bg-slate-100 light:hover:text-slate-900"}`}>
					⚙️ 应用源 ({sources.length})
				</button>
			</div>

			{/* Sources management tab */}
			{tab === "sources" && (
				<div className="space-y-4">
					<div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 space-y-4 light:border-slate-200 light:bg-white">
						<div className="flex items-center justify-between gap-3">
							<div>
								<p className="text-xs uppercase tracking-[0.2em] text-slate-500">新增应用源</p>
								<p className="mt-1 text-sm text-slate-400">先选一个预设，再按你的实际源地址微调。</p>
							</div>
							<span className="rounded-full border border-white/[0.08] px-2 py-1 text-[10px] text-slate-500">点卡片填充</span>
						</div>
						<div className="grid gap-3 sm:grid-cols-3">
							{SOURCE_PRESETS.map((preset) => {
								const active = sourcePreset === preset.key;
								return (
									<button key={preset.key} type="button" onClick={() => applySourcePreset(preset.key)} className={`rounded-xl border p-3 text-left transition ${active ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100" : "border-white/[0.08] bg-white/[0.03] text-slate-300 light:border-slate-200 light:bg-slate-50 hover:bg-white/[0.06] light:hover:bg-white"}`}>
										<div className="flex items-center justify-between gap-2">
											<span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{preset.badge}</span>
											<span className={`rounded-full border px-2 py-0.5 text-[10px] ${active ? "border-cyan-400/30 text-cyan-100" : "border-white/[0.08] text-slate-500 light:border-slate-200"}`}>{preset.type}</span>
										</div>
										<h4 className="mt-2 text-sm font-semibold text-white">{preset.label}</h4>
										<p className="mt-1 text-xs leading-5 text-slate-400">{preset.description}</p>
									</button>
								);
							})}
						</div>
						<div className="grid gap-3 md:grid-cols-2">
							<label className="space-y-1">
								<span className="text-xs text-slate-400">源名称</span>
								<input value={newSourceName} onChange={(e) => setNewSourceName(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40" placeholder="linuxserver" />
							</label>
							<label className="space-y-1">
								<span className="text-xs text-slate-400">显示名称</span>
								<input value={newSourceDisplayName} onChange={(e) => setNewSourceDisplayName(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40" placeholder="LinuxServer.io" />
							</label>
							<label className="space-y-1 md:col-span-2">
								<span className="text-xs text-slate-400">源地址</span>
								<input value={newSourceUrl} onChange={(e) => setNewSourceUrl(e.target.value)} className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40" placeholder="https://..." />
							</label>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="flex gap-2">
								{(["linuxserver", "github", "json"] as const).map((type) => (
									<button key={type} type="button" onClick={() => setNewSourceType(type)} className={`rounded-lg border px-3 py-1.5 text-xs transition ${newSourceType === type ? "border-violet-400/30 bg-violet-400/10 text-violet-100" : "border-white/[0.08] text-slate-300 hover:bg-white/[0.06]"}`}>
										{type}
									</button>
								))}
							</div>
							<button type="button" onClick={doAddSource} className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition">
								添加源
							</button>
						</div>
					</div>
					<div className="flex items-center justify-between">
						<p className="text-xs text-slate-500">管理第三方应用源，同步后可在「社区推荐」中一键安装</p>
						<button
							onClick={() => doSync()}
							disabled={syncing !== null}
							className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition disabled:opacity-40"
						>
							{syncing === "all" ? "同步中…" : "🔄 同步所有源"}
						</button>
					</div>
					{sources.length === 0 && (
						<EmptyState icon="🔗" variant="boxed">
							还没有配置任何第三方源
						</EmptyState>
					)}
					{sources.map((src) => (
						<div key={src.id} data-card className=" p-4 space-y-3">
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-3">
									<span className="text-lg">{src.type === "linuxserver" ? "🐧" : src.type === "github" ? "🐙" : "📡"}</span>
									<div>
										<h3 className="text-sm font-semibold text-white">{src.displayName}</h3>
										<p className="text-xs text-slate-500 mt-0.5">{src.url}</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<span className={`text-[10px] px-2 py-0.5 rounded-full border ${src.enabled ? "border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-400" : "border-white/[0.06] text-slate-500"}`}>
										{src.enabled ? "已启用" : "已禁用"}
									</span>
									{src.lastSyncStatus && (
										<span className={`text-[10px] px-2 py-0.5 rounded-full border ${src.lastSyncStatus === "success" ? "border-emerald-400/20 bg-emerald-500/[0.06] text-emerald-400" : "border-rose-400/20 bg-rose-500/[0.06] text-rose-400"}`}>
											{src.lastSyncStatus === "success" ? "同步成功" : "同步失败"}
										</span>
									)}
								</div>
							</div>
							<div className="flex items-center gap-3 text-[10px] text-slate-500">
								<span>类型: {src.type}</span>
								<span>同步次数: {src.syncCount}</span>
								{src.lastSyncAt && <span>上次同步: {new Date(src.lastSyncAt).toLocaleString()}</span>}
							</div>
							{src.lastSyncError && (
								<div className="text-[10px] text-rose-300 bg-rose-500/[0.06] rounded px-2 py-1">{src.lastSyncError}</div>
							)}
							<div className="flex items-center gap-2 pt-1">
								<button
									onClick={() => doSync(src.id)}
									disabled={syncing !== null}
									className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.06] transition disabled:opacity-50"
								>
									{syncing === src.id ? "同步中…" : "立即同步"}
								</button>
								<button
									onClick={() => doToggleSource(src.id, !src.enabled)}
									className={`rounded-lg border px-3 py-1.5 text-xs transition ${src.enabled ? "border-amber-400/20 text-amber-300 hover:bg-amber-500/[0.08]" : "border-emerald-400/20 text-emerald-300 hover:bg-emerald-500/[0.08]"}`}
								>
									{src.enabled ? "禁用" : "启用"}
								</button>
								<button
									onClick={() => requestDeleteSource(src)}
									className="ml-auto rounded-lg border border-rose-400/20 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/[0.08] transition"
								>
									删除
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Store / Community / Installed content */}
			{tab !== "sources" && CATEGORY_ORDER.map((cat) => {
				const items = grouped[cat];
				if (items.length === 0) return null;
				return (
					<div key={cat} className="space-y-3">
						<h2 className="text-sm font-semibold text-white/70 tracking-wide">{CATEGORY_LABELS[cat] ?? cat}</h2>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{items.map((item) => (
								<ServiceCard
									key={item.slug}
									item={item}
									tab={tab === "community" ? "store" : tab}
									busy={actionSlug === item.slug}
									onInstall={() => openInstallDialog(item)}
									onStart={() => doAction(item.slug, "start")}
									onStop={() => doAction(item.slug, "stop")}
									onUpdate={() => requestUpdate(item)}
									onSync={() => doAction(item.slug, "sync")}
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
					还没有安装任何服务，去商店看看吧
				</EmptyState>
			)}
			{tab === "store" && localAvailable.length === 0 && (
				<EmptyState icon="✅" variant="boxed">
					所有精选服务都已安装！
				</EmptyState>
			)}
			{tab === "community" && remoteAvailable.length === 0 && (
				<EmptyState icon="🌐" variant="boxed">
					{sources.some((s) => s.enabled) ? "所有社区应用都已安装！" : "请先在「应用源」中同步数据"}
				</EmptyState>
			)}

			{/* Install Dialog (port picker) */}
			{installDialog && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeInstallDialog}>
					<div className="w-full max-w-md mx-4 rounded-2xl border border-white/[0.08] bg-[#0c0f1a] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
						<h3 className="text-lg font-semibold text-white mb-1">安装 {installDialog.name}</h3>
						<p className="text-xs text-slate-500 mb-4">选择服务监听的端口，安装后可通过该端口访问服务。</p>

						<div className="space-y-3">
							<label className="block">
								<span className="text-xs text-slate-400 mb-1 block">端口号</span>
								<div className="relative">
									<input
										type="number"
										min={1}
										max={65535}
										value={customPort}
										onChange={(e) => handlePortInput(e.target.value)}
										className={`w-full rounded-lg border bg-white/[0.04] px-4 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition ${
											portCheck
												? portCheck.available
													? "border-emerald-400/40 focus:border-emerald-400"
													: "border-rose-400/40 focus:border-rose-400"
												: "border-white/[0.08] focus:border-cyan-400"
										}`}
										placeholder="1-65535"
									/>
									{portCheck?.checking && (
										<div className="absolute right-3 top-1/2 -translate-y-1/2">
											<div className="w-4 h-4 border-2 border-cyan-400/30 border-t-cyan-400 rounded-full animate-spin" />
										</div>
									)}
									{portCheck && !portCheck.checking && (
										<div className={`absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium ${portCheck.available ? "text-emerald-400" : "text-rose-400"}`}>
											{portCheck.available ? "✓ 可用" : "✗ 占用"}
										</div>
									)}
								</div>
							</label>

							{portCheck && !portCheck.available && portCheck.usedBy && (
								<div className="text-xs text-rose-300/80 bg-rose-500/[0.06] rounded-lg px-3 py-2 border border-rose-400/10">
									端口被占用：{portCheck.usedBy}
								</div>
							)}

							<div className="rounded-xl border border-cyan-400/15 bg-cyan-500/[0.06] p-3 text-xs text-cyan-100">
								<div className="font-semibold">安装前配置预览</div>
								<div className="mt-2 grid gap-1.5 text-cyan-100/80/75">
									<span>镜像：{installPreviewItem?.image ?? "待刷新"}</span>
									<span>容器端口：{installPreviewContainerPort ?? "-"} → 宿主端口 {customPort || installDialog.defaultPort}</span>
									<span>环境变量：{installPreviewEnvCount} 个键（不展示密钥值）</span>
									<span>宿主机挂载：{installPreviewVolumeCount} 条</span>
								</div>
							</div>

							<div className="flex items-center gap-2 text-[10px] text-slate-500">
								<span>推荐端口: {installDialog.defaultPort}</span>
								<button
									type="button"
									onClick={async () => {
										try {
											const data = await csrfFetch<{ port?: number }>(`/api/quick-services/check-port?action=allocate&preferred=${installDialog.defaultPort}`);
											if (data.port) {
												handlePortInput(String(data.port));
											}
										} catch { /* ignore */ }
									}}
									className="text-cyan-400/70 hover:text-cyan-300 underline underline-offset-2"
								>
									自动分配
								</button>
							</div>
						</div>

						<div className="flex items-center justify-end gap-3 mt-6">
							<button onClick={closeInstallDialog} className="rounded-lg border border-white/[0.1] px-4 py-2 text-xs text-slate-400 hover:bg-white/[0.04] transition">
								取消
							</button>
							<button
								onClick={requestInstall}
								disabled={portCheck?.checking || (portCheck ? !portCheck.available : false)}
								className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
							>
								确认安装
							</button>
						</div>
					</div>
				</div>
			)}

			{configPreview && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfigPreview(null)}>
					<div
						role="dialog"
						aria-modal="true"
						aria-label={configPreview.action === "install" ? "确认安装配置" : "确认更新配置"}
						className="w-full max-w-lg mx-4 rounded-2xl border border-cyan-400/20 bg-[#0c0f1a] p-6 shadow-2xl light:bg-white"
						onClick={(e) => e.stopPropagation()}
					>
						<h3 className="text-lg font-semibold text-white mb-2">
							{configPreview.action === "install" ? "确认安装配置" : "确认更新配置"}
						</h3>
						<p className="text-sm leading-6 text-slate-300">
							{configPreview.action === "install" ? "安装会拉取镜像并创建 qs-* 容器。" : "更新会拉取当前镜像并重建 qs-* 容器。"}请确认端口、挂载和公开访问边界后继续。
						</p>
						<div data-card className="mt-4 grid gap-2  p-3 text-xs text-slate-300 light:border-slate-200 light:bg-slate-50">
							<div><span className="text-slate-500">服务：</span>{configPreview.item.name} ({configPreview.item.slug})</div>
							<div><span className="text-slate-500">镜像：</span>{configPreview.item.image}</div>
							<div><span className="text-slate-500">端口：</span>容器 {getPrimaryContainerPort(configPreview.item)} → 宿主机 {configPreview.port}</div>
							<div><span className="text-slate-500">额外端口：</span>{(configPreview.item.extraPorts ?? []).length > 0 ? configPreview.item.extraPorts!.map((port) => `${port.container}→${port.host}`).join("、") : "无"}</div>
							<div><span className="text-slate-500">环境变量：</span>{getEnvCount(configPreview.item)} 个键（不展示密钥值）</div>
							<div>
								<span className="text-slate-500">宿主机挂载：</span>
								{getVolumeMounts(configPreview.item).length > 0 ? getVolumeMounts(configPreview.item).map((volume) => `${volume.host} → ${volume.container}`).join("；") : "无"}
							</div>
						</div>
						<div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/[0.08] p-3 text-xs leading-5 text-amber-100">
							公开端口不会经过 VControlHub 登录鉴权；若服务暴露到公网，请确认防火墙、VPN、反代或应用自身账号已配置。
						</div>
						<div className="mt-6 flex items-center justify-end gap-3">
							<button type="button" onClick={() => setConfigPreview(null)} className="rounded-lg border border-white/[0.1] px-4 py-2 text-xs text-slate-400 hover:bg-white/[0.04] transition">
								取消
							</button>
							<button type="button" onClick={confirmConfigPreview} className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition">
								{configPreview.action === "install" ? "确认安装" : "确认更新"}
							</button>
						</div>
					</div>
				</div>
			)}

			{pendingUninstall && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPendingUninstall(null)}>
					<div
						role="dialog"
						aria-modal="true"
						aria-label="确认卸载快捷服务"
						className="w-full max-w-md mx-4 rounded-2xl border border-rose-400/20 bg-[#0c0f1a] p-6 shadow-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<h3 className="text-lg font-semibold text-white mb-2">确认卸载快捷服务</h3>
						<p className="text-sm leading-6 text-slate-300">
							将卸载 <span className="font-semibold text-white">{pendingUninstall.name}</span>，容器将被删除。默认保留宿主机数据目录，方便重新安装后继续使用。
						</p>
						<label className="mt-4 flex items-start gap-3 rounded-xl border border-rose-400/15 bg-rose-500/[0.06] p-3 text-sm text-rose-100">
							<input
								type="checkbox"
								checked={pendingUninstall.deleteVolumes}
								onChange={(e) => setPendingUninstall((current) => current ? { ...current, deleteVolumes: e.target.checked } : current)}
								className="mt-1 h-4 w-4 rounded border-rose-300/40 bg-transparent text-rose-500"
							/>
							<span>
								<span className="block font-medium">同时删除数据目录</span>
								<span className="mt-1 block text-xs leading-5 text-rose-100/75/75">仅删除该服务模板记录的 `/opt/` 或 `/srv/` 下挂载目录；不会删除 Docker socket、时区文件或根目录。</span>
							</span>
						</label>
						<div className="mt-6 flex items-center justify-end gap-3">
							<button type="button" onClick={() => setPendingUninstall(null)} className="rounded-lg border border-white/[0.1] px-4 py-2 text-xs text-slate-400 hover:bg-white/[0.04] transition">
								取消
							</button>
							<button type="button" onClick={doUninstall} className="rounded-lg bg-rose-500 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-400 transition">
								确认卸载
							</button>
						</div>
					</div>
				</div>
			)}

			{pendingSourceDelete && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPendingSourceDelete(null)}>
					<div
						role="dialog"
						aria-modal="true"
						aria-label="确认删除应用源"
						className="w-full max-w-md mx-4 rounded-2xl border border-rose-400/20 bg-[#0c0f1a] p-6 shadow-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<h3 className="text-lg font-semibold text-white mb-2">确认删除应用源</h3>
						<p className="text-sm leading-6 text-slate-300">
							将删除 <span className="font-semibold text-white">{pendingSourceDelete.displayName}</span>，其同步来的所有应用数据也会一并移除。
						</p>
						<div className="mt-6 flex items-center justify-end gap-3">
							<button type="button" onClick={() => setPendingSourceDelete(null)} className="rounded-lg border border-white/[0.1] px-4 py-2 text-xs text-slate-400 hover:bg-white/[0.04] transition">
								取消
							</button>
							<button type="button" onClick={doDeleteSource} className="rounded-lg bg-rose-500 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-400 transition">
								确认删除
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

/* ── Service Card ────────────────────────────────────────────────── */

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
			<div className="mt-1 text-2xl font-semibold text-white">{value}</div>
		</div>
	);
}

function ServiceCard({ item, tab, busy, onInstall, onStart, onStop, onUpdate, onSync, onUninstall, publicHost }: {
	item: CatalogItem;
	tab: string;
	busy: boolean;
	onInstall: () => void;
	onStart: () => void;
	onStop: () => void;
	onUpdate: () => void;
	onSync: () => void;
	onUninstall: () => void;
	publicHost: string;
}) {
	const statusColor: Record<string, string> = {
		available: "text-slate-500",
		installing: "text-amber-400",
		running: "text-emerald-400",
		stopped: "text-slate-400",
		error: "text-rose-400",
	};
	const statusLabel: Record<string, string> = {
		available: "未安装",
		installing: "安装中…",
		running: "运行中",
		stopped: "已停止",
		error: "异常",
	};

	const displayPort = item.port ?? item.defaultPort;
	const access = buildQuickServiceAccessDescriptor({
		port: item.port,
		defaultPort: item.defaultPort,
		browserHost: typeof window !== "undefined" ? window.location.hostname : null,
		configuredHost: publicHost,
		protocol: typeof window !== "undefined" ? window.location.protocol : null,
		path: item.path,
	});
	const isRemote = item.source !== "local";

	return (
		<div data-card className=" p-4 flex flex-col gap-3 hover:border-white/[0.12] transition light:border-slate-200 light:bg-white light:hover:border-slate-300">
			{/* Header */}
			<div className="flex items-start justify-between">
				<div className="flex items-center gap-2.5">
					<span className="text-2xl">{item.icon}</span>
					<div>
						<h3 className="text-sm font-semibold text-white leading-tight">{item.name}</h3>
						<p className="text-xs text-slate-500 mt-0.5">{item.image}</p>
					</div>
				</div>
				<div className="flex items-center gap-1.5">
					{isRemote && (
						<span className="text-[10px] px-1.5 py-0.5 rounded-full border border-violet-400/20 bg-violet-500/[0.06] text-violet-400">
							{item.source}
						</span>
					)}
					<span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${statusColor[item.status] ?? "text-slate-500"} ${item.status === "running" ? "border-emerald-400/20 bg-emerald-500/[0.06]" : item.status === "error" ? "border-rose-400/20 bg-rose-500/[0.06]" : "border-white/[0.06]"}`}>
						{statusLabel[item.status] ?? item.status}
					</span>
				</div>
			</div>

			{/* Description */}
			<p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{item.description}</p>

			{/* Meta */}
			<div className="flex items-center gap-3 text-[10px] text-slate-500">
				<span>端口 {displayPort}</span>
				{item.path && <span>路径 {item.path}</span>}
				{item.monthlyPulls != null && <span>📈 {(item.monthlyPulls / 1000).toFixed(0)}k 拉取</span>}
				{item.stars != null && <span>⭐ {item.stars}</span>}
			</div>

			{/* Error message */}
			{item.error && (
				<div className="text-[10px] text-rose-300 bg-rose-500/[0.06] rounded px-2 py-1 line-clamp-2">{item.error}</div>
			)}

			{/* Actions */}
			<div className="flex items-center gap-2 mt-auto pt-1">
				{tab !== "installed" && item.status === "available" && (
					<button onClick={onInstall} disabled={busy} className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition disabled:opacity-50 ${isRemote ? "bg-violet-500 hover:bg-violet-400" : "bg-cyan-500 hover:bg-cyan-400"}`}>
						{busy ? "安装中…" : "一键安装"}
					</button>
				)}
				{tab === "installed" && (
					<>
						{item.status === "running" && access && (
							<a href={access.url} target="_blank" rel="noreferrer" aria-label={`访问 ${item.name}（${access.label}）`} title={access.description} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 transition">
								访问
							</a>
						)}
						{item.status === "running" && (
							<button onClick={onStop} disabled={busy} className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.06] transition disabled:opacity-50">
								{busy ? "…" : "停止"}
							</button>
						)}
						{item.status === "stopped" && (
							<button onClick={onStart} disabled={busy} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-400 transition disabled:opacity-50">
								{busy ? "…" : "启动"}
							</button>
						)}
						{item.status === "installing" && (
							<span className="text-xs text-amber-400 animate-pulse">正在拉取镜像…</span>
						)}
						{item.status === "error" && (
							<button onClick={onSync} disabled={busy} className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.06] transition disabled:opacity-50">
								刷新状态
							</button>
						)}
						{(item.status === "running" || item.status === "stopped" || item.status === "error") && (
							<button onClick={onUpdate} disabled={busy} className="rounded-lg border border-cyan-400/25 px-3 py-1.5 text-xs text-cyan-200 hover:bg-cyan-500/[0.08] transition disabled:opacity-50">
								{busy ? "…" : "更新"}
							</button>
						)}
						<button onClick={onUninstall} disabled={busy} className="ml-auto rounded-lg border border-rose-400/20 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/[0.08] transition disabled:opacity-50">
							卸载
						</button>
					</>
				)}
			</div>
		</div>
	);
}
