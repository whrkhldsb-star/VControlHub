import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listServerProfiles } from "@/lib/server/service";
import { PageHeader } from "@/components/page-shell";
import { t } from "@/lib/i18n/translations";
import { HealthDashboardClient } from "./health-dashboard-client";

export default async function HealthPage() {
	const session = await requireSession("/health");

	if (!sessionHasPermission(session, "health:read")) {
		return (
			<main className="p-6">
				<section data-tone="amber" className="rounded-xl border border-amber-500/20 p-6 text-sm text-amber-100">
					<p className="text-base font-semibold text-amber-50">{t("healthPage.noPermission")}</p>
					<p className="mt-2 text-amber-100/80">{t("healthPage.noPermissionHint")}</p>
				</section>
			</main>
		);
	}

	const servers = await listServerProfiles();
	// systemHealth 由客户端挂载后异步拉取（避免实时 SSH/磁盘探测阻塞 RSC，
	// 进入页面后框架立即可见，自检卡片骨架→真实数据渐进填充）。

	return (
		<main className="p-6">
			<PageHeader eyebrow="Health Center" title={t("healthPage.title")} description={t("healthPage.description")} className="mb-6">
				<div className="rounded-full border border-[var(--border)] bg-[var(--surface)]/[0.04] px-4 py-2 text-sm text-[var(--text-secondary)]">
					{t("healthPage.serverCount").replace("{count}", String(servers.length))}
				</div>
			</PageHeader>
			<HealthDashboardClient serverCount={servers.length} initialSystemHealth={null} />
		</main>
	);
}

