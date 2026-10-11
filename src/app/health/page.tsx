import { requirePlatformAdminPage } from "@/lib/auth/page-guard";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { SystemHealthClient } from "./system-health-client";

export const dynamic = "force-dynamic";

/** The platform self-check: platform administrators only (customers watch their servers on /vps-status). */
export default async function HealthPage() {
	const locale = await getServerLocale();
	await requirePlatformAdminPage({ redirectTo: "/health" });

	return (
		<PageShell>
			<PageHeader
				eyebrow={t("healthPage.eyebrow", locale)}
				title={t("healthPage.systemTitle", locale)}
				description={t("healthPage.systemDescription", locale)}
				className="mb-6"
			/>
			<SystemHealthClient initialSystemHealth={null} />
		</PageShell>
	);
}
