"use client";

import Link from "next/link";

import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";

import { ActiveIncidentsBanner } from "./active-incidents-banner";
import {
	healthStatusBadgeTone,
	repairSuggestions,
	repairToneClasses,
	statusLabelKey,
	statusToneClasses,
	tt as applyTemplate,
	unknownTone,
} from "./health-dashboard-helpers";
import { getDomainStatusLabel } from "@/lib/i18n/domain-labels";
import type { SystemHealthReport } from "./health-types";
import { useHealthData } from "./use-health-data";
import { Badge, Notice } from "@/components/ui-primitives";
import { Toolbar, StatCard, StatGrid } from "@/components/page-shell";
import { ActionButton } from "@/components/action-button";
import { RefreshCw } from "@/components/icons";

type Props = { initialSystemHealth?: SystemHealthReport | null };

/**
 * System-only half of the former health dashboard:
 * active incidents + platform self-check / repair suggestions.
 * Per-VPS status lives on `/vps-status`.
 */
export function SystemHealthClient({ initialSystemHealth }: Props) {
	const { locale, t } = useI18n();
	const browserLocale = toDateLocale(locale);
	const {
		systemHealth,
		loadError,
		lastRefresh,
		isRefreshing,
		fetchSystemHealth,
	} = useHealthData({
		initialSystemHealth,
		browserLocale,
		locale,
		mode: "system",
	});

	const tt = (key: string, vars?: Record<string, string | number>) => applyTemplate(t, key, vars);
	const loading = systemHealth === null && !loadError;

	return (
		<div className="space-y-6">
			<ActiveIncidentsBanner />

			{loadError ? <Notice tone="danger" action={{ label: isRefreshing ? t("healthPage.ui.retrying") : t("healthPage.ui.retryLoad"), onClick: () => void fetchSystemHealth(), disabled: isRefreshing }}>{loadError}</Notice> : null}

			<Toolbar className="justify-between">
				<div className="text-xs text-[var(--text-muted)]">
					{t("healthPage.ui.lastRefresh")}: {lastRefresh || "—"}
					{systemHealth
						? systemHealth.summary.critical > 0
							? ` · ${t("healthPage.ui.overallCritical")}`
							: systemHealth.summary.warning > 0
								? ` · ${t("healthPage.ui.overallWarning")}`
								: ` · ${t("healthPage.ui.overallHealthy")}`
						: ""}
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<ActionButton variant="secondary" onClick={() => void fetchSystemHealth()} disabled={isRefreshing}>
						<RefreshCw size={16} aria-hidden className={isRefreshing ? "animate-spin" : undefined} />
						{t("common.refresh")}
					</ActionButton>
					<Link
						href="/vps-status"
						data-action-button
						data-variant="outline"
						className="!px-3 !text-sm"
					>
						{t("healthPage.ui.gotoVpsStatus")}
					</Link>
				</div>
			</Toolbar>

			{systemHealth ? <StatGrid cols={3}>
				<StatCard label={t("healthPage.status.healthy")} value={systemHealth.summary.healthy} accent accentColor="emerald" />
				<StatCard label={t("healthPage.status.warning")} value={systemHealth.summary.warning} accent={systemHealth.summary.warning > 0} accentColor="amber" />
				<StatCard label={t("healthPage.status.critical")} value={systemHealth.summary.critical} accent={systemHealth.summary.critical > 0} accentColor="rose" />
			</StatGrid> : null}

			{loading ? (
				<section
					className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
					aria-busy="true"
					aria-label={t("healthPage.ui.selfCheck")}
				>
					<p className="text-xs uppercase text-[var(--text-muted)]">
						{t("healthPage.ui.selfCheck")}
					</p>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className="h-24 animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
							/>
						))}
					</div>
				</section>
			) : null}

			{systemHealth ? (
				<section className="space-y-4">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<p className="text-xs uppercase text-[var(--text-muted)]">
								{t("healthPage.ui.selfCheck")}
							</p>
							<h2 className="mt-1 text-lg font-semibold text-[var(--text-primary)]">
								{t("healthPage.ui.repairSuggestions")}
							</h2>
							<p className="mt-1 text-xs text-[var(--text-secondary)]">
								{tt("healthPage.ui.checksSummary", systemHealth.summary)}
							</p>
						</div>
						<div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
							<Link
								href="/audit"
								data-action-button
								data-variant="secondary"
								className="!px-3 !py-1.5 !text-sm"
							>
								{t("healthPage.ui.auditLog")}
							</Link>
							<Link
								href="/"
								data-action-button
								data-variant="secondary"
								className="!px-3 !py-1.5 !text-sm"
							>
								{t("healthPage.ui.home")}
							</Link>
						</div>
					</div>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{repairSuggestions(systemHealth.summary, t).map((item) => {
							const tone = repairToneClasses[item.status];
							return (
								<article
									key={item.id}
									className={`rounded-xl border bg-[var(--surface)] p-4 ${tone.border}`}
								>
									<div className="flex items-center justify-between gap-3">
										<h3 className="text-sm font-semibold text-[var(--text-primary)]">
											{item.label}
										</h3>
										<Badge tone={healthStatusBadgeTone(item.status)}>
											{getDomainStatusLabel(t, item.status)}
										</Badge>
									</div>
									<p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
										{item.description}
									</p>
									<p className="mt-3 text-xs text-[var(--text-secondary)]">
										{t("healthPage.ui.suggestedAction")}
										{item.href ? (
											<Link
												href={item.href}
												className="text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
											>
												{item.action}
											</Link>
										) : (
											item.action
										)}
									</p>
								</article>
							);
						})}
					</div>
					<div className="grid gap-2 md:grid-cols-2">
						{systemHealth.checks.map((check) => {
							const sc = statusToneClasses[check.status] ?? unknownTone;
							return (
								<div key={check.id} className={`rounded-xl border p-3 ${sc.bg}`}>
									<div className="flex items-center justify-between gap-3">
										<div className="text-sm font-medium text-[var(--text-primary)]">
											{tt(
												`healthPage.check.${check.id.startsWith("dir-") ? "dir" : check.id}.label`,
												check.params,
											)}
										</div>
										<Badge tone={healthStatusBadgeTone(check.status)}>
											{t(statusLabelKey(check.status))}
										</Badge>
									</div>
									<p className="mt-1 text-xs text-[var(--text-secondary)]">
										{tt(
											`healthPage.check.${check.id.startsWith("dir-") ? "dir" : check.id}.message.${check.messageCode ?? check.status}`,
											check.params,
										)}
									</p>
									{check.detail ? (
										<p className="mt-1 break-all text-xs text-[var(--text-muted)]">
											{check.detail}
										</p>
									) : null}
								</div>
							);
						})}
					</div>
				</section>
			) : null}
		</div>
	);
}
