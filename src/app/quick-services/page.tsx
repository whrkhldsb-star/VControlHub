import { requirePagePermission } from "@/lib/auth/page-guard";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { QuickServicesClient } from "./quick-services-client";

export const dynamic = "force-dynamic";

export default async function QuickServicesPage() {
	// Every quick-service action needs docker:manage; without it the page
	// would only render buttons whose requests the API refuses.
	const session = await requirePagePermission("docker:manage", { redirectTo: "/quick-services" });
	const locale = await getServerLocale();

	return (
		<PageShell>
			<PageHeader eyebrow={t("qsPage.eyebrow", locale)} title={t("qsPage.title", locale)} description={t("qsPage.description", locale)} />
			<QuickServicesClient canManage canManageHubHost={isGlobalTeamManager(session)} />
		</PageShell>
	);
}
