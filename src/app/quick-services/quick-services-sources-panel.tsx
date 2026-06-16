"use client";

/**
 * `SourcesPanel` — the "应用源" tab body. Renders the preset picker
 * + new-source form, then lists every configured app source with
 * per-row enable / sync-now / delete actions.
 *
 * Extracted from `quick-services-client.tsx` (TR-036 T37). Owns the
 * preset + new-source form state (only consumed inside this panel).
 * Receives the parent's `actions` (sync / toggle / add) and the
 * `sources` list. Renders only when the user is on the sources tab,
 * so it could be lazy-loaded; kept synchronous for now because
 * the form is heavily exercised and we want zero chunk-fetch latency
 * on the tab switch.
 */

import { useState } from "react";
import { EmptyState } from "@/components/page-shell";

type AppSource = {
	id: string;
	name: string;
	displayName: string;
	url: string;
	type: string;
	enabled: boolean;
	lastSyncStatus: string | null;
	lastSyncAt: string | null;
	lastSyncError: string | null;
	syncCount: number;
};

type SourcesPanelActions = {
	doSync: (sourceId?: string) => void;
	doToggleSource: (sourceId: string, nextEnabled: boolean) => void;
	doAddSource: (input: { name: string; displayName: string; url: string; type: "json" | "github" | "linuxserver" }) => Promise<void>;
	syncing: string | null;
};

const SOURCE_PRESETS = [
	{
		key: "linuxserver",
		badge: "LinuxServer",
		label: "LinuxServer.io",
		type: "json" as const,
		url: "https://docs.linuxserver.io/general/container-customization",
		description: "LinuxServer 团队精选，覆盖文件、媒体、自动化等场景。",
	},
	{
		key: "github-apps",
		badge: "GitHub",
		label: "GitHub Apps",
		type: "github" as const,
		url: "https://api.github.com/repos/example/apps.json",
		description: "从 GitHub 仓库同步社区维护的应用列表。",
	},
	{
		key: "custom",
		badge: "Custom",
		label: "自定义 JSON",
		type: "json" as const,
		url: "https://example.com/apps.json",
		description: "填写你自己托管的 JSON catalog 地址。",
	},
];

type SourcePresetKey = (typeof SOURCE_PRESETS)[number]["key"];

type SourcesPanelProps = {
	sources: AppSource[];
	actions: SourcesPanelActions;
	onRequestDeleteSource: (source: AppSource) => void;
};

export function SourcesPanel({ sources, actions, onRequestDeleteSource }: SourcesPanelProps) {
	const [sourcePreset, setSourcePreset] = useState<SourcePresetKey | null>(null);
	const [newSourceName, setNewSourceName] = useState("");
	const [newSourceDisplayName, setNewSourceDisplayName] = useState("");
	const [newSourceUrl, setNewSourceUrl] = useState("");
	const [newSourceType, setNewSourceType] = useState<"json" | "github" | "linuxserver">("json");

	const applySourcePreset = (key: SourcePresetKey) => {
		const preset = SOURCE_PRESETS.find((item) => item.key === key);
		if (!preset) return;
		setSourcePreset(key);
		setNewSourceType(preset.type);
		setNewSourceDisplayName(preset.label);
		setNewSourceName(preset.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
		setNewSourceUrl(preset.url);
	};

	const doAddSource = async () => {
		await actions.doAddSource({
			name: newSourceName,
			displayName: newSourceDisplayName,
			url: newSourceUrl,
			type: newSourceType,
		});
		setNewSourceName("");
		setNewSourceDisplayName("");
		setNewSourceUrl("");
		setSourcePreset(null);
	};

	return (
		<div className="space-y-4">
			<div className="rounded-2xl border border-white/[0.06] bg-white/[0.025] p-4 space-y-4">
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
							<button
								key={preset.key}
								type="button"
								onClick={() => applySourcePreset(preset.key)}
								className={`rounded-xl border p-3 text-left transition ${active ? "border-cyan-400/30 bg-cyan-400/10 text-cyan-100" : "border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.06] light:hover:bg-white"}`}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{preset.badge}</span>
									<span className={`rounded-full border px-2 py-0.5 text-[10px] ${active ? "border-cyan-400/30 text-cyan-100" : "border-white/[0.08] text-slate-500"}`}>{preset.type}</span>
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
						<input
							value={newSourceName}
							onChange={(e) => setNewSourceName(e.target.value)}
							className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40"
							placeholder="linuxserver"
						/>
					</label>
					<label className="space-y-1">
						<span className="text-xs text-slate-400">显示名称</span>
						<input
							value={newSourceDisplayName}
							onChange={(e) => setNewSourceDisplayName(e.target.value)}
							className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40"
							placeholder="LinuxServer.io"
						/>
					</label>
					<label className="space-y-1 md:col-span-2">
						<span className="text-xs text-slate-400">源地址</span>
						<input
							value={newSourceUrl}
							onChange={(e) => setNewSourceUrl(e.target.value)}
							className="w-full rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-400/40"
							placeholder="https://..."
						/>
					</label>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex gap-2">
						{(["linuxserver", "github", "json"] as const).map((type) => (
							<button
								key={type}
								type="button"
								onClick={() => setNewSourceType(type)}
								className={`rounded-lg border px-3 py-1.5 text-xs transition ${newSourceType === type ? "border-violet-400/30 bg-violet-400/10 text-violet-100" : "border-white/[0.08] text-slate-300 hover:bg-white/[0.06]"}`}
							>
								{type}
							</button>
						))}
					</div>
					<button
						type="button"
						onClick={doAddSource}
						className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition"
					>
						添加源
					</button>
				</div>
			</div>
			<div className="flex items-center justify-between">
				<p className="text-xs text-slate-500">管理第三方应用源，同步后可在「社区推荐」中一键安装</p>
				<button
					type="button"
					onClick={() => actions.doSync()}
					disabled={actions.syncing !== null}
					className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-cyan-400 transition disabled:opacity-40"
				>
					{actions.syncing === "all" ? "同步中…" : "🔄 同步所有源"}
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
							type="button"
							onClick={() => actions.doSync(src.id)}
							disabled={actions.syncing !== null}
							className="rounded-lg border border-white/[0.1] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.06] transition disabled:opacity-50"
						>
							{actions.syncing === src.id ? "同步中…" : "立即同步"}
						</button>
						<button
							type="button"
							onClick={() => actions.doToggleSource(src.id, !src.enabled)}
							className={`rounded-lg border px-3 py-1.5 text-xs transition ${src.enabled ? "border-amber-400/20 text-amber-300 hover:bg-amber-500/[0.08]" : "border-emerald-400/20 text-emerald-300 hover:bg-emerald-500/[0.08]"}`}
						>
							{src.enabled ? "禁用" : "启用"}
						</button>
						<button
							type="button"
							onClick={() => onRequestDeleteSource(src)}
							className="ml-auto rounded-lg border border-rose-400/20 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/[0.08] transition"
						>
							删除
						</button>
					</div>
				</div>
			))}
		</div>
	);
}
