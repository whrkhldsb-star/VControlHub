import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listServerProfiles } from "@/lib/server/service";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { VpsStatusClient } from "./vps-status-client";
import { Notice } from "@/components/ui-primitives";

export const dynamic = "force-dynamic";

export default async function VpsStatusPage() {
	const locale = await getServerLocale();
	const session = await requireSession("/vps-status");

	if (!sessionHasPermission(session, "health:read")) {
		return (
			<PageShell>
				<Notice tone="warning" title={t("vpsStatusPage.noPermission", locale)}>
					{t("vpsStatusPage.noPermissionHint", locale)}
				</Notice>
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
				<div data-tile className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)]">
					{t("vpsStatusPage.serverCount", locale, { count: servers.length })}
				</div>
			</PageHeader>
			<VpsStatusClient serverCount={servers.length} />
		</PageShell>
	);
}
