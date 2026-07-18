import Link from "next/link";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAuditStats } from "@/lib/audit/service";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";
import { AuditLogClient } from "./audit-client";
import { PageShell, PageHeader, StatCard, EmptyState, StatGrid, SurfacePanel } from "@/components/page-shell";
import { createLogger } from "@/lib/logging";

const HIGH_RISK_ACTIONS = ["command.execute", "storage.file_delete", "server.delete", "user.permission_update", "docker.container_restart", "api_token.create"];

export const dynamic = "force-dynamic";

const logger = createLogger("audit:page");

type AuditPageProps = {
	searchParams?: Promise<{ action?: string }>;
};

function formatCopy(template: string, replacements: Record<string, string | number>) {
	return Object.entries(replacements).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

function formatAuditAction(action: string, locale: Locale): string {
	const key = `audit.action.${action}`;
	const translated = t(key, locale);
	return translated !== key ? translated : action;
}

function getAuditPageCopy(locale: Locale) {
	return {
		title: t("audit.page.title", locale),
		description: t("audit.page.description", locale),
		backHome: t("audit.page.backHome", locale),
		healthCheck: t("audit.page.healthCheck", locale),
		noPermission: t("audit.page.noPermission", locale),
		statsTotal: t("audit.page.stats.total", locale),
		statsRecent24h: t("audit.page.stats.recent24h", locale),
		statsHighRisk: t("audit.page.stats.highRisk", locale),
		highRiskTitle: t("audit.page.highRisk.title", locale),
		highRiskDescription: t("audit.page.highRisk.description", locale),
		highRiskFilterPrefix: t("audit.page.highRisk.filterPrefix", locale),
		topActionsTitle: t("audit.page.topActions.title", locale),
		topActionsEmpty: t("audit.page.topActions.empty", locale),
	};
}

export default async function AuditPage({ searchParams }: AuditPageProps) {
	const params = (await searchParams) ?? {};
	const locale = await getServerLocale();
	const copy = getAuditPageCopy(locale);

	const session = await requireSession("/audit");
	const canRead = sessionHasPermission(session, "audit:read");

	let stats: Awaited<ReturnType<typeof getAuditStats>> | null = null;
	if (canRead) {
		try {
			stats = await getAuditStats(session);
		} catch (error) {
			logger.warn("Failed to load audit stats", error);
		}
	}
	const highRiskCount = stats
		? HIGH_RISK_ACTIONS.reduce((sum, action) => sum + (stats.byAction[action] ?? 0), 0)
		: 0;
	const topActions = stats ? Object.entries(stats.byAction).slice(0, 5) : [];
	const warningRatio = stats && stats.total > 0 ? Math.round(((stats.bySeverity["WARNING"] ?? 0) / stats.total) * 100) : 0;
	const criticalRatio = stats && stats.total > 0 ? Math.round(((stats.bySeverity["CRITICAL"] ?? 0) / stats.total) * 100) : 0;

	return (
		<PageShell maxW="max-w-7xl">
			<PageHeader eyebrow={t("auditPage.eyebrow", locale)} title={copy.title} description={copy.description}>
				<div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
					<Link href="/" data-variant="secondary" className="rounded-xl px-3 py-1.5">{copy.backHome}</Link>
					<Link href="/health" data-variant="secondary" className="rounded-xl px-3 py-1.5">{copy.healthCheck}</Link>
				</div>
			</PageHeader>

			{!canRead ? (
				<EmptyState text={copy.noPermission} variant="boxed" />
			) : (
				<>
					{stats && (
						<section className="mb-6 space-y-4">
							<StatGrid cols={5} className="mb-0">
								<StatCard label={copy.statsTotal} value={String(stats.total)} />
								<StatCard label={copy.statsRecent24h} value={String(stats.recentCount)} accent />
								<StatCard label={t("auditPage.statsWarning", locale)} value={String(stats.bySeverity["WARNING"] ?? 0)} accentColor="amber" />
								<StatCard label={t("auditPage.statsCritical", locale)} value={String(stats.bySeverity["CRITICAL"] ?? 0)} accentColor="rose" />
								<StatCard label={copy.statsHighRisk} value={String(highRiskCount)} accentColor="rose" />
							</StatGrid>
							<div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
								<div data-tone="rose" className="rounded-2xl border border-[var(--danger-border)] bg-[color-mix(in_srgb,var(--danger-bg)_55%,var(--surface))] p-4 shadow-[var(--shadow-sm)]">
									<h2 className="text-sm font-semibold text-[var(--text-primary)]">{copy.highRiskTitle}</h2>
									<p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
										{formatCopy(copy.highRiskDescription, { warningRatio, criticalRatio })}
									</p>
									<div className="mt-4 flex flex-wrap gap-2">
										{HIGH_RISK_ACTIONS.slice(0, 4).map((action) => (
											<Link
												key={`quick-${action}`}
												href={`/audit?action=${encodeURIComponent(action)}`}
												className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-[11px] text-[var(--danger)] transition hover:bg-[var(--surface-hover)]"
											>
												{copy.highRiskFilterPrefix} {formatAuditAction(action, locale)}
											</Link>
										))}
									</div>
								</div>
								<SurfacePanel title={copy.topActionsTitle} className="!space-y-3">
									<div className="space-y-2">
										{topActions.length === 0 ? (
											<p className="text-sm text-[var(--text-muted)]">{copy.topActionsEmpty}</p>
										) : (
											topActions.map(([action, count]) => (
												<div key={action} className="flex items-center justify-between gap-3 text-sm">
													<span className="truncate text-[var(--text-secondary)]">{formatAuditAction(action, locale)}</span>
													<span className="rounded-full border border-[var(--border)] bg-[var(--surface-elevated)] px-2 py-0.5 text-xs tabular-nums text-[var(--text-secondary)]">{count}</span>
												</div>
											))
										)}
									</div>
								</SurfacePanel>
							</div>
						</section>
					)}
					<AuditLogClient initialActionFilter={params.action ?? ""} />
				</>
			)}
		</PageShell>
	);
}
