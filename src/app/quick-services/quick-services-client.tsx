"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";

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
	status: string;
	id: string | null;
	containerId: string | null;
	port: number | null;
	error: string | null;
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

type Tab = "store" | "installed";

/* ── Main Component ─────────────────────────────────────────────── */

export function QuickServicesClient({ canManage }: { canManage: boolean }) {
	const [catalog, setCatalog] = useState<CatalogItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("store");
	const [actionSlug, setActionSlug] = useState<string | null>(null);
	const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);
	// Install dialog state
	const [installDialog, setInstallDialog] = useState<{ slug: string; name: string; defaultPort: number } | null>(null);
	const [customPort, setCustomPort] = useState<string>("");
	const [portCheck, setPortCheck] = useState<{ available: boolean; usedBy: string | null; checking: boolean } | null>(null);

	const portCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const fetchCatalog = useCallback(async () => {
		try {
			const data = await csrfFetch("/api/quick-services");
setCatalog(data.catalog ?? []);
		} catch (err) {
			setError(err instanceof Error ? err.message : "加载失败");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => { fetchCatalog(); }, [fetchCatalog]);

	// Auto-dismiss message
	useEffect(() => {
		if (!message) return;
		const t = setTimeout(() => setMessage(null), 4000);
		return () => clearTimeout(t);
	}, [message]);

	// Poll installing services
	useEffect(() => {
		const installing = catalog.filter((s) => s.status === "installing");
		if (installing.length === 0) return;
		const t = setTimeout(fetchCatalog, 3000);
		return () => clearTimeout(t);
	}, [catalog, fetchCatalog]);

	// Debounced port availability check
	const checkPortAvailability = useCallback(async (port: number) => {
		setPortCheck({ available: false, usedBy: null, checking: true });
		try {
			const data = await csrfFetch("/api/quick-services");
setPortCheck({ available: data.available, usedBy: data.usedBy ?? null, checking: false });
		} catch {
			setPortCheck({ available: true, usedBy: null, checking: false });
		}
	}, []);

	// When user types a custom port, debounce check
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

	// Open install dialog
	const openInstallDialog = (item: CatalogItem) => {
		setInstallDialog({ slug: item.slug, name: item.name, defaultPort: item.defaultPort });
		setCustomPort(String(item.defaultPort));
		// Immediately check the default port
		setPortCheck({ available: false, usedBy: null, checking: true });
		checkPortAvailability(item.defaultPort);
	};

	// Close install dialog
	const closeInstallDialog = () => {
		setInstallDialog(null);
		setCustomPort("");
		setPortCheck(null);
		if (portCheckTimer.current) clearTimeout(portCheckTimer.current);
	};

	const doInstall = async () => {
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
		setActionSlug(installDialog.slug);
		closeInstallDialog();
		try {
			const data = await csrfFetch("/api/quick-services", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slug: installDialog.slug, customPort: port }),
			});
			setMessage({ type: "ok", text: `${installDialog.name} 安装任务已提交，正在拉取镜像…` });
			setTimeout(fetchCatalog, 1500);
		} catch (err) {
			setMessage({ type: "err", text: err instanceof Error ? err.message : "安装失败" });
		} finally {
			setActionSlug(null);
		}
	};

	const doAction = async (slug: string, action: string) => {
		setActionSlug(slug);
		try {
			const data = await csrfFetch(`/api/quick-services/${slug}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action }),
			});
			setMessage({ type: "ok", text: data.status === "running" ? `已启动` : `已停止` });
			fetchCatalog();
		} catch (err) {
			setMessage({ type: "err", text: err instanceof Error ? err.message : "操作失败" });
		} finally {
			setActionSlug(null);
		}
	};

	const doUninstall = async (slug: string) => {
		if (!confirm(`确定要卸载吗？容器将被删除，数据卷保留。`)) return;
		setActionSlug(slug);
		try {
			const data = await csrfFetch(`/api/quick-services/${slug}`, { method: "DELETE" });
			setMessage({ type: "ok", text: `已卸载` });
			fetchCatalog();
		} catch (err) {
			setMessage({ type: "err", text: err instanceof Error ? err.message : "卸载失败" });
		} finally {
			setActionSlug(null);
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

	const installed = catalog.filter((s) => s.status !== "available");
	const available = catalog.filter((s) => s.status === "available");

	// Group by category
	const grouped: Record<string, CatalogItem[]> = {};
	for (const cat of CATEGORY_ORDER) grouped[cat] = [];
	for (const item of tab === "installed" ? installed : available) {
		const cat = CATEGORY_ORDER.includes(item.category) ? item.category : "other";
		grouped[cat].push(item);
	}

	return (
		<div className="space-y-6">
			{/* Message */}
			{message && (
				<div className={`rounded-lg px-4 py-3 text-sm ${message.type === "ok" ? "bg-emerald-500/[0.08] border border-emerald-400/20 text-emerald-200" : "bg-rose-500/[0.08] border border-rose-400/20 text-rose-200"}`}>
					{message.text}
				</div>
			)}

			{/* Tab bar */}
			<div className="flex gap-1 rounded-xl bg-white/[0.03] p-1 border border-white/[0.06] w-fit">
				<button onClick={() => setTab("store")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "store" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-white"}`}>
					🏪 服务商店 ({available.length})
				</button>
				<button onClick={() => setTab("installed")} className={`px-4 py-2 rounded-lg text-sm font-medium transition ${tab === "installed" ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-white"}`}>
					📦 已安装 ({installed.length})
				</button>
			</div>

			{/* Content */}
			{CATEGORY_ORDER.map((cat) => {
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
									tab={tab}
									busy={actionSlug === item.slug}
									onInstall={() => openInstallDialog(item)}
									onStart={() => doAction(item.slug, "start")}
									onStop={() => doAction(item.slug, "stop")}
									onSync={() => doAction(item.slug, "sync")}
									onUninstall={() => doUninstall(item.slug)}
								/>
							))}
						</div>
					</div>
				);
			})}

			{tab === "installed" && installed.length === 0 && (
				<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
					<div className="text-4xl mb-3">📦</div>
					<p className="text-sm text-slate-500">还没有安装任何服务，去商店看看吧</p>
				</div>
			)}
			{tab === "store" && available.length === 0 && (
				<div className="rounded-xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center">
					<div className="text-4xl mb-3">✅</div>
					<p className="text-sm text-slate-500">所有服务都已安装！</p>
				</div>
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

							<div className="flex items-center gap-2 text-[10px] text-slate-500">
								<span>推荐端口: {installDialog.defaultPort}</span>
								<button
									type="button"
									onClick={async () => {
										try {
							const data = await csrfFetch(`/api/quick-services/check-port?action=allocate&preferred=${installDialog.defaultPort}`);
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
								onClick={doInstall}
								disabled={portCheck?.checking || (portCheck ? !portCheck.available : false)}
								className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition disabled:opacity-40 disabled:cursor-not-allowed"
							>
								确认安装
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

/* ── Service Card ────────────────────────────────────────────────── */

function ServiceCard({ item, tab, busy, onInstall, onStart, onStop, onSync, onUninstall }: {
	item: CatalogItem;
	tab: Tab;
	busy: boolean;
	onInstall: () => void;
	onStart: () => void;
	onStop: () => void;
	onSync: () => void;
	onUninstall: () => void;
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

	return (
		<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 flex flex-col gap-3 hover:border-white/[0.12] transition">
			{/* Header */}
			<div className="flex items-start justify-between">
				<div className="flex items-center gap-2.5">
					<span className="text-2xl">{item.icon}</span>
					<div>
						<h3 className="text-sm font-semibold text-white leading-tight">{item.name}</h3>
						<p className="text-xs text-slate-500 mt-0.5">{item.image}</p>
					</div>
				</div>
				<span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${statusColor[item.status] ?? "text-slate-500"} ${item.status === "running" ? "border-emerald-400/20 bg-emerald-500/[0.06]" : item.status === "error" ? "border-rose-400/20 bg-rose-500/[0.06]" : "border-white/[0.06]"}`}>
					{statusLabel[item.status] ?? item.status}
				</span>
			</div>

			{/* Description */}
			<p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{item.description}</p>

			{/* Meta */}
			<div className="flex items-center gap-3 text-[10px] text-slate-500">
				<span>端口 {displayPort}</span>
				{item.path && <span>路径 {item.path}</span>}
			</div>

			{/* Error message */}
			{item.error && (
				<div className="text-[10px] text-rose-300 bg-rose-500/[0.06] rounded px-2 py-1 line-clamp-2">{item.error}</div>
			)}

			{/* Actions */}
			<div className="flex items-center gap-2 mt-auto pt-1">
				{tab === "store" && item.status === "available" && (
					<button onClick={onInstall} disabled={busy} className="rounded-lg bg-cyan-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition disabled:opacity-50">
						{busy ? "安装中…" : "一键安装"}
					</button>
				)}
				{tab === "installed" && (
					<>
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
						<button onClick={onUninstall} disabled={busy} className="ml-auto rounded-lg border border-rose-400/20 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/[0.08] transition disabled:opacity-50">
							卸载
						</button>
					</>
				)}
			</div>
		</div>
	);
}
