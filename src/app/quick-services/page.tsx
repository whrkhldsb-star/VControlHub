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
			<PageHeader eyebrow="Quick Services" title="快捷服务" description="一键安装常用自托管服务，自动 Docker 部署，安装即用。">
				<div className="flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
					<Link href="/deployments" className="rounded-full border border-[var(--border)] bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">{t("qsPage.deployPanelLink", locale)}</Link>
					<Link href="/docker" className="rounded-full border border-[var(--border)] bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">{t("qsPage.dockerLink", locale)}</Link>
					<Link href="/files" className="rounded-full border border-[var(--border)] bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">{t("qsPage.filesLink", locale)}</Link>
				</div>
			</PageHeader>
			<QuickServicesClient canManage={canManage} />
		</PageShell>
	);
}
