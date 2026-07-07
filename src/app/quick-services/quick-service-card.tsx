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
import { useI18n } from "@/lib/i18n/use-locale";

const statusColor: Record<string, string> = {
	available: "text-[var(--text-muted)]",
	installing: "text-[var(--warning)]",
	running: "text-[var(--success)]",
	stopped: "text-[var(--text-muted)]",
	error: "text-[var(--danger)]",
};

const statusLabelKeys: Record<string, string> = {
	available: "qsPage.statusAvailable",
	installing: "qsPage.statusInstalling",
	running: "qsPage.statusRunning",
	stopped: "qsPage.statusStopped",
	error: "qsPage.statusError",
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
	const { t } = useI18n();
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
		<div data-card className=" p-4 flex flex-col gap-3 hover:border-[var(--border)]/[0.12] transition light:hover:border-[var(--border)]">
			{/* Header */}
			<div className="flex items-start justify-between">
				<div className="flex items-center gap-2.5">
					<span className="text-2xl">{item.icon}</span>
					<div>
						<h3 className="text-sm font-semibold text-[var(--text-primary)] leading-tight">{item.name}</h3>
						<p className="text-xs text-[var(--text-muted)] mt-0.5">{item.image}</p>
					</div>
				</div>
				<div className="flex items-center gap-1.5">
					{isRemote && (
						<span className="text-[10px] px-1.5 py-0.5 rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]">
							{item.source}
						</span>
					)}
					<span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${statusColor[item.status] ?? "text-[var(--text-muted)]"} ${item.status === "running" ? "border-[var(--success-border)] bg-[var(--success)]/[0.10]" : item.status === "error" ? "border-[var(--danger-border)] bg-[var(--danger)]/[0.10]" : "border-[var(--border)]"}`}>
						{(statusLabelKeys[item.status] && t(statusLabelKeys[item.status] as string)) || item.status}
					</span>
				</div>
			</div>

			{/* Description */}
			<p className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-2">{item.description}</p>

			{/* Meta */}
			<div className="flex items-center gap-3 text-[10px] text-[var(--text-muted)]">
				<span>{t("qsPage.portLabel").replace("{port}", String(displayPort))}</span>
				{item.path && <span>{t("qsPage.pathLabel").replace("{path}", item.path)}</span>}
				{item.monthlyPulls != null && <span>{t("qsPage.monthlyPulls").replace("{pulls}", (item.monthlyPulls / 1000).toFixed(0))}</span>}
				{item.stars != null && <span>⭐ {item.stars}</span>}
			</div>

			{/* Error message */}
			{item.error && (
				<div className="text-[10px] text-[var(--danger)] bg-[var(--danger)]/[0.10] rounded px-2 py-1 line-clamp-2">{item.error}</div>
			)}

			{/* Actions */}
			<div className="flex items-center gap-2 mt-auto pt-1">
				{tab !== "installed" && item.status === "available" && (
					<button onClick={onInstall} disabled={busy} className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold text-[var(--color-action-fg)] transition disabled:opacity-50 ${isRemote ? "bg-[var(--color-action)] hover:bg-[var(--color-action-bg)]" : "bg-[var(--color-action)] hover:bg-[var(--color-action-bg)]"}`}>
						{busy ? t("qsPage.installingLabel") : t("qsPage.installNow")}
					</button>
				)}
				{tab === "installed" && (
					<>
						{item.status === "running" && access && (
							<a href={access.url} target="_blank" rel="noreferrer" aria-label={t("qsPage.accessAria").replace("{name}", item.name).replace("{label}", access.label)} title={access.description} className="rounded-lg bg-[var(--success)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--success-bg)] hover:text-[var(--success)] transition">
								{t("qsPage.access")}
							</a>
						)}
						{item.status === "running" && (
							<button onClick={onStop} disabled={busy} className="rounded-lg border border-[var(--border)]/[0.1] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10] transition disabled:opacity-50">
								{busy ? t("qsPage.busy") : t("qsPage.stop")}
							</button>
						)}
						{item.status === "stopped" && (
							<button onClick={onStart} disabled={busy} className="rounded-lg bg-[var(--success)] px-3 py-1.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--success-bg)] hover:text-[var(--success)] transition disabled:opacity-50">
								{busy ? t("qsPage.busy") : t("qsPage.start")}
							</button>
						)}
						{item.status === "installing" && (
							<span className="text-xs text-[var(--warning)] animate-pulse">{t("qsPage.pullingImage")}</span>
						)}
						{item.status === "error" && (
							<button onClick={onSync} disabled={busy} className="rounded-lg border border-[var(--border)]/[0.1] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface)]/[0.10] transition disabled:opacity-50">
								{t("qsPage.refreshStatus")}
							</button>
						)}
						{(item.status === "running" || item.status === "stopped" || item.status === "error") && (
							<button onClick={onUpdate} disabled={busy} className="rounded-lg border border-[var(--color-action-border)]/25 px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--color-action)]/[0.10] transition disabled:opacity-50">
								{busy ? t("qsPage.busy") : t("qsPage.update")}
							</button>
						)}
						<button onClick={onUninstall} disabled={busy} className="ml-auto rounded-lg border border-[var(--danger-border)] px-3 py-1.5 text-xs text-[var(--danger)] hover:bg-[var(--danger-bg)] hover:text-[var(--danger)]/[0.10] transition disabled:opacity-50">
							{t("qsPage.uninstall")}
						</button>
					</>
				)}
			</div>
		</div>
	);
}
