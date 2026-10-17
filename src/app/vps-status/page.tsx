import { requirePagePermission } from "@/lib/auth/page-guard";
import { countServerProfiles } from "@/lib/server/service";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { VpsStatusClient } from "./vps-status-client";

export const dynamic = "force-dynamic";

export default async function VpsStatusPage() {
	const locale = await getServerLocale();
	const session = await requirePagePermission("health:read", { redirectTo: "/vps-status" });

	const serverCount = await countServerProfiles(session);

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("vpsStatusPage.eyebrow", locale)}
				title={t("vpsStatusPage.title", locale)}
				description={t("vpsStatusPage.description", locale)}
				className="mb-6"
			>
				<div data-tile className="px-4 py-2 text-sm font-medium text-[var(--text-secondary)]">
					{t("vpsStatusPage.serverCount", locale, { count: serverCount })}
				</div>
			</PageHeader>
			<VpsStatusClient serverCount={serverCount} />
		</PageShell>
	);
}
