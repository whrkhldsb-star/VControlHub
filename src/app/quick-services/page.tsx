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
			<PageHeader eyebrow="Quick Services" title={t("qsPage.title", locale)} description={t("qsPage.description", locale)}>
				<div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
					<Link href="/deployments" className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-1.5 transition hover:bg-[var(--surface)]/[0.10]">{t("qsPage.deployPanelLink", locale)}</Link>
					<Link href="/docker" className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-1.5 transition hover:bg-[var(--surface)]/[0.10]">{t("qsPage.dockerLink", locale)}</Link>
					<Link href="/files" className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-1.5 transition hover:bg-[var(--surface)]/[0.10]">{t("qsPage.filesLink", locale)}</Link>
				</div>
			</PageHeader>
			<QuickServicesClient canManage={canManage} />
		</PageShell>
	);
}
