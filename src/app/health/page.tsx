import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listServerProfiles } from "@/lib/server/service";
import { collectSystemHealthChecks } from "@/lib/system-health/service";
import { PageHeader } from "@/components/page-shell";
import { HealthDashboardClient } from "./health-dashboard-client";

export default async function HealthPage() {
	const session = await requireSession("/health");

	if (!sessionHasPermission(session, "health:read")) {
		return (
			<main className="p-6">
				<section className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-6 text-sm text-amber-100">
					<p className="text-base font-semibold text-amber-50">缺少健康监控权限</p>
					<p className="mt-2 text-amber-100/80">需要 health:read 权限后才能查看节点健康详情和历史指标。</p>
				</section>
			</main>
		);
	}

	const servers = await listServerProfiles();
	const systemHealth = await collectSystemHealthChecks({ projectRoot: process.cwd() }).catch(() => null);

	return (
		<main className="p-6">
			<PageHeader eyebrow="Health Center" title="节点健康" description="实时采集 SSH 指标、保存历史趋势，并与告警规则联动。" className="mb-6">
				<div className="rounded-full border border-[var(--border)] bg-white/[0.03] px-4 py-2 text-sm text-[var(--text-secondary)]">
					纳管节点 {servers.length} 台
				</div>
			</PageHeader>
			<HealthDashboardClient serverCount={servers.length} initialSystemHealth={systemHealth} />
		</main>
	);
}
