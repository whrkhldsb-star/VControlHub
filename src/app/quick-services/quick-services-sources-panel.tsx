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
import { useI18n } from "@/lib/i18n/use-locale";

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

function getSourcePresets(t: (k: string) => string) {
  return [
	{
		key: "linuxserver",
		badge: "LinuxServer",
		label: "LinuxServer.io",
		type: "json" as const,
		url: "https://docs.linuxserver.io/general/container-customization",
		description: t("quickServicesPage.sources.linuxserverDesc"),
	},
	{
		key: "github-apps",
		badge: "GitHub",
		label: "GitHub Apps",
		type: "github" as const,
		url: "https://api.github.com/repos/example/apps.json",
		description: t("quickServicesPage.sources.githubDesc"),
	},
	{
		key: "custom",
		badge: "Custom",
		label: t("quickServicesPage.sources.customLabel"),
		type: "json" as const,
		url: "https://example.com/apps.json",
		description: t("quickServicesPage.sources.customDesc"),
	},
  ];
}

type SourcePresetKey = "linuxserver" | "github-apps" | "custom";

type SourcesPanelProps = {
	sources: AppSource[];
	actions: SourcesPanelActions;
	onRequestDeleteSource: (source: AppSource) => void;
};

export function SourcesPanel({ sources, actions, onRequestDeleteSource }: SourcesPanelProps) {
	const { t } = useI18n();
	const [sourcePreset, setSourcePreset] = useState<SourcePresetKey | null>(null);
	const [newSourceName, setNewSourceName] = useState("");
	const [newSourceDisplayName, setNewSourceDisplayName] = useState("");
	const [newSourceUrl, setNewSourceUrl] = useState("");
	const [newSourceType, setNewSourceType] = useState<"json" | "github" | "linuxserver">("json");

	const applySourcePreset = (key: SourcePresetKey) => {
		const preset = getSourcePresets(t).find((item) => item.key === key);
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
			<div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.025] p-4 space-y-4">
				<div className="flex items-center justify-between gap-3">
					<div>
						<p className="text-xs uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("quickServicesPage.sources.header")}</p>
						<p className="mt-1 text-sm text-[var(--text-muted)]">{t("quickServicesPage.sources.headerDesc")}</p>
					</div>
					<span className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--text-muted)]">{t("quickServicesPage.sources.tapToFill")}</span>
				</div>
				<div className="grid gap-3 sm:grid-cols-3">
					{getSourcePresets(t).map((preset) => {
						const active = sourcePreset === preset.key;
						return (
							<button
								key={preset.key}
								type="button"
								onClick={() => applySourcePreset(preset.key as SourcePresetKey)}
								className={`rounded-xl border p-3 text-left transition ${active ? "border-[var(--color-action-border)]/30 bg-[var(--color-action-bg)]/10 text-[var(--text-primary)]" : "border-[var(--border)] bg-[var(--surface)]/[0.04] text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10] light:hover:bg-[var(--surface)]"}`}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">{preset.badge}</span>
									<span className={`rounded-full border px-2 py-0.5 text-[10px] ${active ? "border-[var(--color-action-border)]/30 text-[var(--text-primary)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>{preset.type}</span>
								</div>
								<h4 className="mt-2 text-sm font-semibold text-[var(--text-primary)]">{preset.label}</h4>
								<p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{preset.description}</p>
							</button>
						);
					})}
				</div>
				<div className="grid gap-3 md:grid-cols-2">
					<label className="space-y-1">
						<span className="text-xs text-[var(--text-muted)]">{t("quickServicesPage.sources.name")}</span>
						<input
							value={newSourceName}
							onChange={(e) => setNewSourceName(e.target.value)}
							className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-action-border)]/40"
							placeholder="linuxserver"
						/>
					</label>
					<label className="space-y-1">
						<span className="text-xs text-[var(--text-muted)]">{t("quickServicesPage.sources.displayName")}</span>
						<input
							value={newSourceDisplayName}
							onChange={(e) => setNewSourceDisplayName(e.target.value)}
							className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-action-border)]/40"
							placeholder="LinuxServer.io"
						/>
					</label>
					<label className="space-y-1 md:col-span-2">
						<span className="text-xs text-[var(--text-muted)]">{t("quickServicesPage.sources.url")}</span>
						<input
							value={newSourceUrl}
							onChange={(e) => setNewSourceUrl(e.target.value)}
							className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--color-action-border)]/40"
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
								className={`rounded-lg border px-3 py-1.5 text-xs transition ${newSourceType === type ? "border-violet-400/30 bg-violet-400/10 text-violet-100" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10]"}`}
							>
								{type}
							</button>
						))}
					</div>
					<button
						type="button"
						onClick={doAddSource}
						className="rounded-lg bg-[var(--color-action)] px-4 py-2 text-xs font-semibold text-[var(--color-action-fg)] hover:bg-[var(--color-action-bg)] transition"
					>
						添加源
					</button>
				</div>
			</div>
			<div className="flex items-center justify-between">
				<p className="text-xs text-[var(--text-muted)]">{t("quickServicesPage.sources.manageDesc")}，同步后可在「社区推荐」中一键安装</p>
				<button
					type="button"
					onClick={() => actions.doSync()}
					disabled={actions.syncing !== null}
					className="rounded-lg bg-[var(--color-action)] px-4 py-2 text-xs font-semibold text-[var(--color-action-fg)] hover:bg-[var(--color-action-bg)] transition disabled:opacity-40"
				>
					{actions.syncing === "all" ? t("quickServicesPage.sources.syncing") : t("quickServicesPage.sources.syncAll")}
				</button>
			</div>
			{sources.length === 0 && (
				<EmptyState icon="🔗" variant="boxed">
					{t("quickServicesPage.sources.empty")}
				</EmptyState>
			)}
			{sources.map((src) => (
				<div key={src.id} data-card className=" p-4 space-y-3">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<span className="text-lg">{src.type === "linuxserver" ? "🐧" : src.type === "github" ? "🐙" : "📡"}</span>
							<div>
								<h3 className="text-sm font-semibold text-[var(--text-primary)]">{src.displayName}</h3>
								<p className="text-xs text-[var(--text-muted)] mt-0.5">{src.url}</p>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<span className={`text-[10px] px-2 py-0.5 rounded-full border ${src.enabled ? "border-emerald-400/20 bg-emerald-500/[0.10] text-emerald-400" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
								{src.enabled ? t("quickServicesPage.sources.status.enabled") : t("quickServicesPage.sources.status.disabled")}
							</span>
							{src.lastSyncStatus && (
								<span className={`text-[10px] px-2 py-0.5 rounded-full border ${src.lastSyncStatus === "success" ? "border-emerald-400/20 bg-emerald-500/[0.10] text-emerald-400" : "border-rose-400/20 bg-rose-500/[0.10] text-rose-400"}`}>
									{src.lastSyncStatus === "success" ? t("quickServicesPage.sources.status.syncSuccess") : t("quickServicesPage.sources.status.syncFailed")}
								</span>
							)}
						</div>
					</div>
					<div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
						<span>{t("quickServicesPage.sources.type") + ": " + src.type}</span>
						<span>{t("quickServicesPage.sources.syncCount") + ": " + String(src.syncCount)}</span>
						{src.lastSyncAt && <span>{t("quickServicesPage.sources.lastSyncAt") + ": " + new Date(src.lastSyncAt).toLocaleString()}</span>}
					</div>
					{src.lastSyncError && (
						<div className="text-[10px] text-rose-300 bg-rose-500/[0.10] rounded px-2 py-1">{src.lastSyncError}</div>
					)}
					<div className="flex items-center gap-2 pt-1">
						<button
							type="button"
							onClick={() => actions.doSync(src.id)}
							disabled={actions.syncing !== null}
							className="rounded-lg border border-[var(--border)]/[0.1] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10] transition disabled:opacity-50"
						>
							{actions.syncing === src.id ? "同步中…" : t("quickServicesPage.sources.syncNow")}
						</button>
						<button
							type="button"
							onClick={() => actions.doToggleSource(src.id, !src.enabled)}
							className={`rounded-lg border px-3 py-1.5 text-xs transition ${src.enabled ? "border-amber-400/20 text-amber-300 hover:bg-amber-500/[0.10]" : "border-emerald-400/20 text-emerald-300 hover:bg-emerald-500/[0.10]"}`}
						>
							{src.enabled ? t("quickServicesPage.sources.disable") : t("quickServicesPage.sources.enable")}
						</button>
						<button
							type="button"
							onClick={() => onRequestDeleteSource(src)}
							className="ml-auto rounded-lg border border-rose-400/20 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/[0.10] transition"
						>
							删除
						</button>
					</div>
				</div>
			))}
		</div>
	);
}
