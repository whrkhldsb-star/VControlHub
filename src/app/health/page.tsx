import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { SystemHealthClient } from "./system-health-client";
import { Notice } from "@/components/ui-primitives";

export default async function HealthPage() {
	const locale = await getServerLocale();
	const session = await requireSession("/health");

	if (!sessionHasPermission(session, "health:read")) {
		return (
			<PageShell>
				<Notice tone="warning" title={t("healthPage.noPermission", locale)}>
					{t("healthPage.noPermissionHint", locale)}
				</Notice>
			</PageShell>
		);
	}

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
