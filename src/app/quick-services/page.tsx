import Link from "next/link";
import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
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
			<PageHeader eyebrow={t("qsPage.eyebrow", locale)} title={t("qsPage.title", locale)} description={t("qsPage.description", locale)}>
				<div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
					<Link href="/deployments" data-variant="secondary" className="rounded-xl px-3 py-1.5">{t("qsPage.deployPanelLink", locale)}</Link>
					<Link href="/docker" data-variant="secondary" className="rounded-xl px-3 py-1.5">{t("qsPage.dockerLink", locale)}</Link>
					<Link href="/files" data-variant="secondary" className="rounded-xl px-3 py-1.5">{t("qsPage.filesLink", locale)}</Link>
				</div>
			</PageHeader>
			<QuickServicesClient canManage={canManage} />
		</PageShell>
	);
}
