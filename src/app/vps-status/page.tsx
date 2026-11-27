import { sessionHasPermission } from "@/lib/auth/authorization";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { countServerProfiles } from "@/lib/server/service";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { VpsStatusClient } from "./vps-status-client";

export const dynamic = "force-dynamic";

export default async function VpsStatusPage() {
	const locale = await getServerLocale();
	const session = await requirePagePermission("health:read", { redirectTo: "/vps-status" });

	const serverCount = await countServerProfiles(session);
	const canReadServers = sessionHasPermission(session, "server:read");

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("vpsStatusPage.eyebrow", locale)}
				title={t("vpsStatusPage.title", locale)}
				description={`${t("vpsStatusPage.description", locale)} ${t("vpsStatusPage.serverCount", locale, { count: serverCount })}`}
				className="mb-6"
			/>
			<VpsStatusClient serverCount={serverCount} isPlatformAdmin={isGlobalTeamManager(session)} canReadServers={canReadServers} />
		</PageShell>
	);
}
