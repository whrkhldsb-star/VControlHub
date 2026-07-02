import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listServerProfiles } from "@/lib/server/service";
import { PageShell, PageHeader } from "@/components/page-shell";
import { t } from "@/lib/i18n/translations";
import { HealthDashboardClient } from "./health-dashboard-client";

export default async function HealthPage() {
	const session = await requireSession("/health");

	if (!sessionHasPermission(session, "health:read")) {
		return (
			<PageShell>
				<section data-tone="amber" className="rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] p-6 text-sm text-[var(--warning)]">
					<p className="text-base font-semibold text-[var(--warning)]">{t("healthPage.noPermission")}</p>
					<p className="mt-2 text-[var(--warning)] opacity-80">{t("healthPage.noPermissionHint")}</p>
				</section>
			</PageShell>
		);
	}

	const servers = await listServerProfiles();

	return (
		<PageShell>
			<PageHeader eyebrow="Health Center" title={t("healthPage.title")} description={t("healthPage.description")} className="mb-6">
				<div className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm text-[var(--text-secondary)]">
					{t("healthPage.serverCount").replace("{count}", String(servers.length))}
				</div>
			</PageHeader>
			<HealthDashboardClient serverCount={servers.length} initialSystemHealth={null} />
		</PageShell>
	);
}

