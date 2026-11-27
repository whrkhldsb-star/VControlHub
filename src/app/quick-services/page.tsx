import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { QuickServicesClient } from "./quick-services-client";

export const dynamic = "force-dynamic";

export default async function QuickServicesPage({ searchParams }: { searchParams?: Promise<{ server?: string | string[] }> } = {}) {
	// Every quick-service action needs docker:manage; without it the page
	// would only render buttons whose requests the API refuses.
	const session = await requirePagePermission("docker:manage", { redirectTo: "/quick-services" });
	const requested = (await searchParams)?.server;
	const server = Array.isArray(requested) ? requested[0] : requested;
	const locale = await getServerLocale();

	return (
		<PageShell>
			<PageHeader eyebrow={t("qsPage.eyebrow", locale)} title={t("qsPage.title", locale)} description={t("qsPage.description", locale)} />
			<QuickServicesClient
				key={server}
				requestedServer={server}
				canManage
				canManageHubHost={isGlobalTeamManager(session)}
				canReadServers={sessionHasPermission(session, "server:read")}
			/>
		</PageShell>
	);
}
