import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { QuickServicesClient } from "./quick-services-client";

export const dynamic = "force-dynamic";

export default async function QuickServicesPage() {
	const session = await requireSession("/quick-services");
	const canManage = sessionHasPermission(session, "docker:manage");
	const locale = await getServerLocale();

	return (
		<PageShell>
			<PageHeader eyebrow={t("qsPage.eyebrow", locale)} title={t("qsPage.title", locale)} description={t("qsPage.description", locale)} />
			<QuickServicesClient canManage={canManage} canManageHubHost={isGlobalTeamManager(session)} />
		</PageShell>
	);
}
