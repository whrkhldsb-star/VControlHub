import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { PageShell, PageHeader } from "@/components/page-shell";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { SystemHealthClient } from "./system-health-client";

export default async function HealthPage() {
	const locale = await getServerLocale();
	const session = await requireSession("/health");

	if (!sessionHasPermission(session, "health:read")) {
		return (
			<PageShell>
				<section className="rounded-2xl border border-[var(--warning-border)] bg-[color-mix(in_srgb,var(--warning-bg)_45%,var(--surface))] p-6 text-sm text-[var(--warning)]">
					<p className="text-base font-semibold text-[var(--warning)]">
						{t("healthPage.noPermission")}
					</p>
					<p className="mt-2 text-[var(--warning)] opacity-80">
						{t("healthPage.noPermissionHint")}
					</p>
				</section>
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
