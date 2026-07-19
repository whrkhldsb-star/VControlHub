import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listServerProfiles } from "@/lib/server/service";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { VpsStatusClient } from "./vps-status-client";

export const dynamic = "force-dynamic";

export default async function VpsStatusPage() {
	const locale = await getServerLocale();
	const session = await requireSession("/vps-status");

	if (!sessionHasPermission(session, "health:read")) {
		return (
			<PageShell>
				<section className="rounded-2xl border border-[var(--warning-border)] bg-[color-mix(in_srgb,var(--warning-bg)_45%,var(--surface))] p-6 text-sm text-[var(--warning)]">
					<p className="text-base font-semibold text-[var(--warning)]">
						{t("vpsStatusPage.noPermission", locale)}
					</p>
					<p className="mt-2 text-[var(--warning)] opacity-80">
						{t("vpsStatusPage.noPermissionHint", locale)}
					</p>
				</section>
			</PageShell>
		);
	}

	const servers = await listServerProfiles(session);

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("vpsStatusPage.eyebrow", locale)}
				title={t("vpsStatusPage.title", locale)}
				description={t("vpsStatusPage.description", locale)}
				className="mb-6"
			>
				<div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)]">
					{t("vpsStatusPage.serverCount", locale).replace("{count}", String(servers.length))}
				</div>
			</PageHeader>
			<VpsStatusClient serverCount={servers.length} />
		</PageShell>
	);
}
