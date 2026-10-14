import { PageHeader, PageShell } from "@/components/page-shell";
import { requirePlatformAdminPage } from "@/lib/auth/page-guard";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { loadPublicSite } from "@/lib/public-status/site";
import { PublicStatusAdminClient } from "./public-status-admin-client";

export const dynamic = "force-dynamic";

/** Status board management: platform administrators only. */
export default async function PublicStatusAdminPage() {
	const locale = await getServerLocale();
	await requirePlatformAdminPage({ redirectTo: "/public-status" });
	const site = await loadPublicSite();
	return (
		<PageShell>
			<PageHeader
				eyebrow={t("publicStatusAdmin.eyebrow", locale)}
				title={t("publicStatusAdmin.title", locale)}
				description={t("publicStatusAdmin.description", locale)}
			/>
			<PublicStatusAdminClient initialSite={site} />
		</PageShell>
	);
}
