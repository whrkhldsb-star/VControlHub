"use client";

import Link from "next/link";

import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";

import { ActiveIncidentsBanner } from "./active-incidents-banner";
import {
	repairSuggestions,
	repairToneClasses,
	statusLabelKey,
	statusToneClasses,
	tt as applyTemplate,
	unknownTone,
} from "./health-dashboard-helpers";
import type { SystemHealthReport } from "./health-types";
import { useHealthData } from "./use-health-data";

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
		autoRefresh,
		refreshIntervalSeconds,
		fetchSystemHealth,
		setAutoRefresh,
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

			{loadError ? (
				<div
					role="alert"
					data-tone="rose"
					className="rounded-xl border border-[var(--danger-border)] p-3 text-sm text-[var(--danger)]"
				>
					{loadError}
					<button
						type="button"
						onClick={() => void fetchSystemHealth()}
						disabled={isRefreshing}
						data-action-button
						data-variant="danger"
						className="!mt-3 !px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-50"
					>
						{isRefreshing ? t("healthPage.ui.retrying") : t("healthPage.ui.retryLoad")}
					</button>
				</div>
			) : null}

			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
					<Link
						href="/vps-status"
						data-action-button
						data-variant="outline"
						className="!px-3 !text-xs"
					>
						{t("healthPage.ui.gotoVpsStatus")}
					</Link>
					<button
						type="button"
						onClick={() => void fetchSystemHealth()}
						disabled={isRefreshing}
						aria-label={t("healthPage.ui.refreshAria")}
						data-action-button
						data-variant="secondary"
						className="inline-flex min-h-11 items-center !px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-60"
					>
						{isRefreshing ? t("healthPage.ui.refreshing") : t("healthPage.ui.refresh")}
					</button>
					<label className="flex min-h-11 items-center gap-2 text-xs text-[var(--text-secondary)]">
						<span>{t("healthPage.ui.autoRefresh")}</span>
						<button
							type="button"
							onClick={() => setAutoRefresh(!autoRefresh)}
							disabled={refreshIntervalSeconds <= 0}
							aria-label={t("healthPage.ui.toggleAutoRefreshAria")}
							className={`relative h-4 w-8 min-h-11 min-w-11 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ? "bg-[var(--color-action)]" : "bg-[var(--surface)]"}`}
						>
							<span
								className={`absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--text-primary)] shadow transition-transform ${autoRefresh ? "translate-x-2" : "-translate-x-3"}`}
							/>
						</button>
						<span>
							{refreshIntervalSeconds <= 0
								? t("healthPage.ui.autoRefreshOff")
								: autoRefresh
									? tt("healthPage.ui.autoRefreshEvery", {
											label: getRefreshIntervalLabel(refreshIntervalSeconds),
										})
									: tt("healthPage.ui.autoRefreshPaused", {
											label: getRefreshIntervalLabel(refreshIntervalSeconds),
										})}
						</span>
					</label>
				</div>
			</div>

			{loading ? (
				<section
					className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4"
					aria-busy="true"
					aria-label={t("healthPage.ui.selfCheck")}
				>
					<p className="text-xs uppercase tracking-[0.25em] text-[var(--text-muted)]">
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
				<section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="min-w-0">
							<p className="text-xs uppercase tracking-[0.25em] text-[var(--text-muted)]">
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
								className="!px-3 !py-1.5 !text-xs"
							>
								{t("healthPage.ui.auditLog")}
							</Link>
							<Link
								href="/"
								data-action-button
								data-variant="secondary"
								className="!px-3 !py-1.5 !text-xs"
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
									className={`rounded-xl border p-4 ${tone.border} ${tone.bg}`}
								>
									<div className="flex items-center justify-between gap-3">
										<h3 className="text-sm font-semibold text-[var(--text-primary)]">
											{item.label}
										</h3>
										<span
											className={`rounded-full border px-2 py-0.5 text-[10px] ${tone.badge}`}
										>
											{item.status}
										</span>
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
										<span
											className={`rounded-full border px-2 py-0.5 text-[10px] ${sc.text}`}
										>
											{t(statusLabelKey(check.status))}
										</span>
									</div>
									<p className="mt-1 text-xs text-[var(--text-secondary)]">
										{tt(
											`healthPage.check.${check.id.startsWith("dir-") ? "dir" : check.id}.message.${check.messageCode ?? check.status}`,
											check.params,
										)}
									</p>
									{check.detail ? (
										<p className="mt-1 break-all text-[11px] text-[var(--text-muted)]">
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
