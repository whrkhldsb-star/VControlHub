"use client";

import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
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
import { Badge } from "@/components/ui-primitives";

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
	accessHost,
	accessProtocol,
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
	accessHost: string;
	accessProtocol?: string;
}) {
	const { t } = useI18n();
	const displayPort = item.port ?? item.defaultPort;
	const access = buildQuickServiceAccessDescriptor({
		port: item.port,
		defaultPort: item.defaultPort,
		browserHost: typeof window !== "undefined" ? window.location.hostname : null,
		configuredHost: accessHost,
		protocol: accessProtocol ?? (typeof window !== "undefined" ? window.location.protocol : null),
		path: item.path,
	});
	const isRemote = item.source !== "local";

	return (
		<div data-card className="flex flex-col gap-3 p-4 transition hover:bg-[var(--surface-elevated)]">
			{/* Header */}
			<div className="flex items-start justify-between">
				<div className="flex items-center gap-2.5">
					<span className="text-2xl">{item.icon}</span>
					<div>
						<h3 className="ui-title-group">{item.name}</h3>
						<p className="text-xs text-[var(--text-muted)] mt-0.5">{item.image}</p>
					</div>
				</div>
				<div className="flex items-center gap-1.5">
					{isRemote && (
						<Badge tone="accent">
							{item.source}
						</Badge>
					)}
					<StatusBadge tone={item.status === "running" ? "success" : item.status === "error" ? "danger" : item.status === "installing" ? "warning" : "neutral"} size="sm">
						{(statusLabelKeys[item.status] && t(statusLabelKeys[item.status] as string)) || item.status}
					</StatusBadge>
				</div>
			</div>

			{/* Description */}
			<p className="text-xs text-[var(--text-muted)] leading-relaxed line-clamp-2">{item.description}</p>

			{/* Meta */}
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
				<span>{t("qsPage.portLabel", { port: displayPort })}</span>
				{item.path && <span>{t("qsPage.pathLabel", { path: item.path })}</span>}
				{item.monthlyPulls != null && <span>{t("qsPage.monthlyPulls", { pulls: (item.monthlyPulls / 1000).toFixed(0) })}</span>}
				{item.stars != null && <span>⭐ {item.stars}</span>}
			</div>

			{/* Error message */}
			{item.error && (
				<div className="rounded bg-[var(--danger-bg)] px-2 py-1 text-xs leading-5 text-[var(--danger)] line-clamp-2">{item.error}</div>
			)}

			{/* Actions */}
			<div className="mt-auto flex min-h-9 flex-wrap items-center gap-2 pt-1">
				{tab !== "installed" && item.status === "available" && (
					<ActionButton size="sm" variant="outline" onClick={onInstall} disabled={busy}>
						{busy ? t("qsPage.installingLabel") : t("qsPage.installNow")}
					</ActionButton>
				)}
				{tab === "installed" && (
					<>
						{item.status === "running" && access && (
							<a
								href={access.url}
								target="_blank"
								rel="noreferrer"
								aria-label={t("qsPage.accessAria", { name: item.name, label: t(`qsPage.access.${access.mode}.label`) })}
								title={t(`qsPage.access.${access.mode}.description`)}
								data-action-button data-size="sm"
								data-variant="success-solid">
								{t("qsPage.access")}
							</a>
						)}
						{item.status === "running" && (
							<ActionButton size="sm" type="button" variant="secondary" onClick={onStop} disabled={busy}>
								{busy ? t("qsPage.busy") : t("qsPage.stop")}
							</ActionButton>
						)}
						{item.status === "stopped" && (
							<ActionButton size="sm" variant="success" onClick={onStart} disabled={busy}>
								{busy ? t("qsPage.busy") : t("qsPage.start")}
							</ActionButton>
						)}
						{item.status === "installing" && (
							<span className="text-xs text-[var(--warning)] animate-pulse">{t("qsPage.pullingImage")}</span>
						)}
						{item.status === "error" && (
							<ActionButton size="sm" type="button" variant="secondary" onClick={onSync} disabled={busy}>
								{t("qsPage.refreshStatus")}
							</ActionButton>
						)}
						{(item.status === "running" || item.status === "stopped" || item.status === "error") && (
							<ActionButton size="sm" type="button" variant="outline" onClick={onUpdate} disabled={busy}>
								{busy ? t("qsPage.busy") : t("qsPage.update")}
							</ActionButton>
						)}
						<ActionButton size="sm" type="button" variant="danger" onClick={onUninstall} disabled={busy} className="ml-auto">
							{t("qsPage.uninstall")}
						</ActionButton>
					</>
				)}
			</div>
		</div>
	);
}
