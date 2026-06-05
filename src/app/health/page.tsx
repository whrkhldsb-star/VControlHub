import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listServerProfiles } from "@/lib/server/service";
import { collectSystemHealthChecks } from "@/lib/system-health/service";
import { HealthDashboardClient } from "./health-dashboard-client";

export default async function HealthPage() {
	const session = await requireSession("/health");

	if (!sessionHasPermission(session, "health:read")) {
		return (
			<main className="p-6">
				<section className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-6 text-sm text-amber-100 light:text-amber-900">
					<p className="text-base font-semibold text-amber-50">缺少健康监控权限</p>
					<p className="mt-2 text-amber-100/80 light:text-amber-900/80">需要 health:read 权限后才能查看节点健康详情和历史指标。</p>
				</section>
			</main>
		);
	}

	const servers = await listServerProfiles();
	const systemHealth = await collectSystemHealthChecks({ projectRoot: process.cwd() }).catch(() => null);

	return (
		<main className="p-6">
			<header className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
				<div>
					<p className="text-sm uppercase tracking-[0.3em] text-cyan-400">Health Center</p>
					<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white light:text-slate-900">节点健康</h1>
					<p className="mt-2 text-sm text-slate-400 light:text-slate-600">实时采集 SSH 指标、保存历史趋势，并与告警规则联动。</p>
				</div>
				<div className="rounded-full border border-white/10 light:border-slate-200 bg-white/[0.03] px-4 py-2 text-sm text-slate-300 light:text-slate-700">
					纳管节点 {servers.length} 台
				</div>
			</header>
			<HealthDashboardClient serverCount={servers.length} initialSystemHealth={systemHealth} />
		</main>
	);
}
