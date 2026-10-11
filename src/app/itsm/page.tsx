import { requirePagePermission } from "@/lib/auth/page-guard";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { listItsmConnections, listItsmEvents } from "@/lib/itsm/service";
import { ItsmPageClient } from "./itsm-page-client";
import { config } from "@/lib/config/env";

export const dynamic = "force-dynamic";

/** ITSM connections are management configuration: `ticket:manage` admits the page. */
export default async function ItsmPage() {
	const session = await requirePagePermission("ticket:manage", { redirectTo: "/itsm" });
	const locale = await getServerLocale();

	// Always pass session so teamWhere scopes connections/events to the caller's customer.
	const [connections, events] = await Promise.all([
		listItsmConnections(session),
		listItsmEvents({ limit: 30, session }),
	]);
	// Prefer configured app base URL; empty lets the client use window.location.origin.
	const publicBaseUrl = config.app.baseUrl?.replace(/\/$/, "") || "";

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("itsmPage.eyebrow", locale)}
				title={t("itsmPage.title", locale)}
				description={t("itsmPage.desc", locale)}
				className="mb-6"
			/>
			<ItsmPageClient
				initialConnections={connections}
				initialEvents={events}
				canManage
				publicBaseUrl={publicBaseUrl}
			/>
		</PageShell>
	);
}
