import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PageShell, PageHeader, EmptyState } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { listItsmConnections, listItsmEvents } from "@/lib/itsm/service";
import { ItsmPageClient } from "./itsm-page-client";
import { config } from "@/lib/config/env";

export const dynamic = "force-dynamic";

export default async function ItsmPage() {
	const session = await requireSession("/itsm");
	const canManage = sessionHasPermission(session, "ticket:manage");
	const locale = await getServerLocale();

	if (!canManage && !sessionHasPermission(session, "ticket:read")) {
		return (
			<PageShell>
				<EmptyState text={t("itsmPage.permissionDenied", locale)} />
			</PageShell>
		);
	}

	// Always pass session so teamWhere scopes connections/events to the caller's team
	// (plus shared teamId=null). Omitting session previously listed every tenant's rows.
	const connections = canManage ? await listItsmConnections(session) : [];
	const events = canManage ? await listItsmEvents({ limit: 30, session }) : [];
	const publicBaseUrl =
		config.app.baseUrl?.replace(/\/$/, "") ||
		"https://whrkhldsb.qzz.io";

	return (
		<PageShell maxW="max-w-5xl">
			<PageHeader
				eyebrow={t("itsmPage.eyebrow", locale)}
				title={t("itsmPage.title", locale)}
				description={t("itsmPage.desc", locale)}
				className="mb-6"
			/>
			{canManage ? (
				<ItsmPageClient
					initialConnections={connections}
					initialEvents={events}
					canManage={canManage}
					publicBaseUrl={publicBaseUrl}
				/>
			) : (
				<EmptyState text={t("itsmPage.permissionDenied", locale)} />
			)}
		</PageShell>
	);
}
