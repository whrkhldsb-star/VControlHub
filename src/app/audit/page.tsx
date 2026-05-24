import Link from "next/link";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getAuditStats } from "@/lib/audit/service";
import { AuditLogClient } from "./audit-client";
import { PageShell, StatCard, EmptyState } from "@/components/page-shell";

const HIGH_RISK_ACTIONS = ["command.execute", "storage.file_delete", "server.delete", "user.permission_update", "docker.container_restart", "api_token.create"];

export const dynamic = "force-dynamic";

type AuditPageProps = {
	searchParams?: Promise<{ action?: string }>;
};

export default async function AuditPage({ searchParams }: AuditPageProps) {
	const params = (await searchParams) ?? {};

	const session = await requireSession("/audit");
	const canRead = sessionHasPermission(session, "audit:read");

	let stats: Awaited<ReturnType<typeof getAuditStats>> | null = null;
	if (canRead) {
		try {
			stats = await getAuditStats();
		} catch {
			// DB might be empty
		}
	}
	const highRiskCount = stats
		? HIGH_RISK_ACTIONS.reduce((sum, action) => sum + (stats.byAction[action] ?? 0), 0)
		: 0;
	const topActions = stats ? Object.entries(stats.byAction).slice(0, 5) : [];
	const warningRatio = stats && stats.total > 0 ? Math.round(((stats.bySeverity["WARNING"] ?? 0) / stats.total) * 100) : 0;
	const criticalRatio = stats && stats.total > 0 ? Math.round(((stats.bySeverity["CRITICAL"] ?? 0) / stats.total) * 100) : 0;

	return (
		<PageShell maxW="max-w-7xl">
			<header className="mb-8">
				<h1 className="text-3xl font-semibold tracking-tight text-white">审计日志</h1>
				<p className="mt-1.5 text-sm text-slate-500">平台操作追踪与安全审计</p>
				<div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-400">
					<Link href="/" className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">回到首页</Link>
					<Link href="/health" className="rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 transition hover:bg-white/[0.06]">去系统自检</Link>
				</div>
			</header>

			{!canRead ? (
				<EmptyState text="你没有查看审计日志的权限。" variant="boxed" />
			) : (
				<>
					{stats && (
						<section className="mb-8 space-y-4">
							<div className="grid gap-3 sm:grid-cols-5">
								<StatCard label="总记录" value={String(stats.total)} />
								<StatCard label="24h 新增" value={String(stats.recentCount)} accent />
								<StatCard label="WARNING" value={String(stats.bySeverity["WARNING"] ?? 0)} accentColor="amber" />
								<StatCard label="CRITICAL" value={String(stats.bySeverity["CRITICAL"] ?? 0)} accentColor="rose" />
								<StatCard label="高风险动作" value={String(highRiskCount)} accentColor="rose" />
							</div>
							<div className="grid gap-3 lg:grid-cols-[1.2fr_1fr]">
								<div className="rounded-xl border border-rose-400/20 bg-rose-400/[0.06] p-4">
									<h2 className="text-sm font-semibold text-white">高风险动作监控</h2>
									<p className="mt-2 text-sm leading-6 text-slate-300">已重点跟踪命令执行、文件删除、服务器删除、权限变更、容器重启和令牌创建。当前 WARNING 占比 {warningRatio}% ，CRITICAL 占比 {criticalRatio}% ，异常增多时优先从下方日志按动作筛选复核。</p>
					<div className="mt-4 flex flex-wrap gap-2">
						{HIGH_RISK_ACTIONS.slice(0, 4).map((action) => (
							<Link
								key={`quick-${action}`}
								href={`/audit?action=${encodeURIComponent(action)}`}
								className="rounded-full border border-white/10 bg-white/[0.02] px-2 py-1 text-[11px] text-rose-100/80 transition hover:bg-white/[0.06]"
							>
								按动作筛查：{action}
							</Link>
						))}
					</div>
								</div>
								<div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
									<h2 className="text-sm font-semibold text-white">最常见动作</h2>
									<div className="mt-3 space-y-2">
										{topActions.length === 0 ? (
											<p className="text-sm text-slate-500">暂无动作统计。</p>
										) : topActions.map(([action, count]) => (
											<div key={action} className="flex items-center justify-between gap-3 text-sm">
												<span className="truncate text-slate-300">{action}</span>
												<span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-xs text-slate-400">{count}</span>
											</div>
										))}
									</div>
								</div>
							</div>
						</section>
					)}
					<AuditLogClient initialActionFilter={params.action ?? ""} />
				</>
			)}
		</PageShell>
	);
}
