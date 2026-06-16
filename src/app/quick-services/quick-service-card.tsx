"use client";

/**
 * `ServiceCard` — single Quick Service tile used in both the
 * "推荐快速服务" rail and the per-category grid.
 *
 * Extracted from `quick-services-client.tsx` (TR-036 T37) so the
 * static catalog tile code ships in its own module. Pure presentational
 * component: receives the catalog item + lifecycle callbacks from the
 * parent and renders a card with status, ports, actions.
 *
 * Imports use `typeof` only on `CatalogItem` (a TS-only import — see
 * `ComponentProps<typeof import(...)>` rationale) so the actual catalog
 * type lives next to the parent that fetches it.
 */

import { buildQuickServiceAccessDescriptor } from "@/lib/quick-service/access-url";

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

type CatalogItemLike = {
	slug: string;
	name: string;
	icon: string;
	image: string;
	description: string;
	category: string;
	defaultPort: number;
	port: number | null;
	path?: string | null;
	source?: string | null;
	monthlyPulls?: number | null;
	stars?: number | null;
	status: string;
	error?: string | null;
};

export function ServiceCard({
	item,
	tab,
	busy,
	onInstall,
	onStart,
	onStop,
	onUpdate,
	onSync,
	onUninstall,
	publicHost,
}: {
	item: CatalogItemLike;
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
		<div data-card className=" p-4 flex flex-col gap-3 hover:border-white/[0.12] transition light:hover:border-slate-300">
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
