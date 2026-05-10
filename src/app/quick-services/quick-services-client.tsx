"use client";

import { useState, useCallback, useEffect } from "react";

/* ── Types ──────────────────────────────────────────────────────── */

interface CatalogItem {
	slug: string;
	name: string;
	category: string;
	icon: string;
	description: string;
	image: string;
	port: number;
	path: string;
	status: string;
	id: string | null;
	containerId: string | null;
	error: string | null;
}

const CATEGORY_LABELS: Record<string, string> = {
	storage: "☁️ 存储网盘",
	media: "🎬 媒体影视",
	devtools: "🔧 开发工具",
	network: "🌐 网络监控",
	other: "📦 其他服务",
};

const CATEGORY_ORDER = ["storage", "media", "devtools", "network", "other"];

type Tab = "store" | "installed";

/* ── Main Component ─────────────────────────────────────────────── */

export function QuickServicesClient({ canManage }: { canManage: boolean }) {
	const [catalog, setCatalog] = useState<CatalogItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [tab, setTab] = useState<Tab>("store");
	const [actionSlug, setActionSlug] = useState<string | null>(null);
	const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

	const fetchCatalog = useCallback(async () => {
		try {
			const res = await fetch("/api/quick-services");
			if (!res.ok) throw new Error("加载失败");
			const data = await res.json();
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

	const doInstall = async (slug: string) => {
		setActionSlug(slug);
		try {
			const res = await fetch("/api/quick-services", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ slug }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "安装失败");
			setMessage({ type: "ok", text: `${slug} 安装任务已提交，正在拉取镜像…` });
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
			const res = await fetch(`/api/quick-services/${slug}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ action }),
			});
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "操作失败");
			setMessage({ type: "ok", text: data.status === "running" ? `${slug} 已启动` : `${slug} 已停止` });
			fetchCatalog();
		} catch (err) {
			setMessage({ type: "err", text: err instanceof Error ? err.message : "操作失败" });
		} finally {
			setActionSlug(null);
		}
	};

	const doUninstall = async (slug: string) => {
		if (!confirm(`确定要卸载 ${slug} 吗？容器将被删除，数据卷保留。`)) return;
		setActionSlug(slug);
		try {
			const res = await fetch(`/api/quick-services/${slug}`, { method: "DELETE" });
			const data = await res.json();
			if (!res.ok) throw new Error(data.error ?? "卸载失败");
			setMessage({ type: "ok", text: `${slug} 已卸载` });
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
									onInstall={() => doInstall(item.slug)}
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
				<span>端口 {item.port}</span>
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
