import Link from "next/link";

import { requireSession } from "@/lib/auth/require-session";
import { listServerProfiles } from "@/lib/server/service";
import { getStorageOverview } from "@/lib/storage/service";
import { listCommandRequests } from "@/lib/command/service";
import { getUnreadCount } from "@/lib/notification/service";
import { prisma } from "@/lib/db";
import { PageShell, StatCard, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

const dashboardAuditDateFormatter = new Intl.DateTimeFormat("zh-CN", {
	timeZone: "Asia/Shanghai",
	year: "numeric",
	month: "2-digit",
	day: "2-digit",
	hour: "2-digit",
	minute: "2-digit",
	second: "2-digit",
	hour12: false,
});

function formatDashboardAuditDate(value: Date | string | number) {
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return "—";
	return dashboardAuditDateFormatter.format(date);
}

export default async function Home() {
	const session = await requireSession("/");
	const [servers, storage, requests, recentAuditLogs, downloadStats, unreadNotif, activeScheduled] = await Promise.all([
		listServerProfiles(),
		getStorageOverview(),
		listCommandRequests(),
		prisma.auditLog.findMany({
			take: 5,
			orderBy: { createdAt: "desc" },
			include: { actor: { select: { username: true, displayName: true } } },
		}),
		prisma.downloadTask.groupBy({ by: ["status"], _count: true }),
		getUnreadCount(session.userId),
		prisma.scheduledTask.count({ where: { status: "ACTIVE" } }),
	]);

	const pendingCount = requests.filter((r) => r.status === "PENDING_APPROVAL").length;
	const recentRequests = requests.slice(0, 5);
	const enabledServers = servers.filter((s) => s.enabled);
	const disabledServers = servers.filter((s) => !s.enabled);
	const sshKeyServers = servers.filter((s) => s.sshKey);
	const directGatewayCount = servers.filter((s) => s.directGateway?.enabled).length;

	const dlRunning = downloadStats.find((d) => d.status === "RUNNING")?._count ?? 0;
	const dlCompleted = downloadStats.find((d) => d.status === "COMPLETED")?._count ?? 0;
	const dlFailed = downloadStats.find((d) => d.status === "FAILED")?._count ?? 0;

	return (
		<PageShell maxW="max-w-7xl">
				{/* Header */}
				<header className="mb-10">
					<h1 className="text-3xl font-semibold tracking-tight text-white">仪表盘</h1>
					<p className="mt-1.5 text-sm text-slate-500">当前用户：{session.username}</p>
				</header>

				{/* VPS hero */}
				<section className="mb-8 rounded-2xl border border-cyan-400/15 bg-cyan-400/[0.04] p-5">
					<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
						<div>
							<p className="text-xs uppercase tracking-[0.22em] text-cyan-300/70">VPS 状态总览</p>
							<h2 className="mt-2 text-2xl font-semibold text-white">{enabledServers.length} 台在线 VPS</h2>
							<p className="mt-1 text-sm text-slate-400">
								共 {servers.length} 台纳管节点，{sshKeyServers.length} 台绑定 SSH 密钥，{directGatewayCount} 台直连网关在线。
							</p>
						</div>
						<Link href="/servers" className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/15">
							管理 VPS 与密钥 →
						</Link>
					</div>
					<div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<StatCard label="在线 VPS" value={String(enabledServers.length)} accent={enabledServers.length > 0} accentColor="cyan" />
						<StatCard label="离线/停用" value={String(disabledServers.length)} accent={disabledServers.length > 0} accentColor="amber" />
						<StatCard label="SSH 密钥绑定" value={`${sshKeyServers.length}/${servers.length}`} accent={sshKeyServers.length > 0} />
						<StatCard label="Direct Gateway" value={String(directGatewayCount)} accent={directGatewayCount > 0} accentColor="cyan" />
					</div>
				</section>

				{/* Stats Cards - grouped overview */}
				<section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
					<div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
						<h2 className="text-sm font-medium text-white/80">核心资源</h2>
						<div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-2">
							<StatCard label="VPS 节点" value={String(servers.length)} accent={false} />
							<StatCard label="启用节点" value={String(servers.filter((s) => s.enabled).length)} accent={false} />
							<StatCard label="存储节点" value={String(storage.stats.totalNodes)} accent={false} />
							<StatCard label="文件条目" value={String(storage.stats.totalEntries)} accent={false} />
						</div>
					</div>
					<div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
						<h2 className="text-sm font-medium text-white/80">运维队列</h2>
						<div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
							<StatCard label="待审批" value={String(pendingCount)} accent={pendingCount > 0} accentColor="amber" />
							<StatCard
								label="下载任务"
								value={dlRunning > 0 ? `${dlRunning} 运行中` : String(dlRunning + dlCompleted + dlFailed)}
								accent={dlRunning > 0}
								accentColor="cyan"
								detail={dlRunning > 0 ? `${dlRunning} 运行 / ${dlCompleted} 完成 / ${dlFailed} 失败` : undefined}
							/>
							<StatCard
								label="通知/定时"
								value={`${unreadNotif} 未读 / ${activeScheduled} 活跃`}
								accent={unreadNotif > 0 || activeScheduled > 0}
								accentColor={unreadNotif > 0 ? "amber" : "cyan"}
							/>
						</div>
					</div>
				</section>

				{/* Quick Links */}
				<section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
					<QuickLink
						href="/servers"
						title="VPS 管理"
						desc="节点纳管、SSH 密钥与命令分发"
						icon={
							<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
						}
					/>
					<QuickLink
						href="/files"
						title="文件管理"
						desc="文件浏览、上传下载与存储节点管理"
						icon={
							<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>
						}
					/>
					<QuickLink
						href="/downloads"
						title="远程下载"
						desc="URL/磁力链接下载到指定 VPS"
						icon={
							<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
						}
						badge={dlRunning > 0 ? `${dlRunning} 进行中` : undefined}
						badgeColor="cyan"
					/>
					<QuickLink
						href="/requests"
						title="审批中心"
						desc="命令审批与执行日志"
						icon={
							<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
						}
						badge={pendingCount > 0 ? `${pendingCount} 待审批` : undefined}
						badgeColor="amber"
					/>
					<QuickLink
						href="/scheduled-tasks"
						title="定时任务"
						desc="Cron 调度与自动化命令下发"
						icon={
							<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
						}
						badge={activeScheduled > 0 ? `${activeScheduled} 活跃` : undefined}
						badgeColor="cyan"
					/>
					<QuickLink
						href="/notifications"
						title="通知中心"
						desc="系统告警与操作通知"
						icon={
							<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
						}
						badge={unreadNotif > 0 ? `${unreadNotif} 未读` : undefined}
						badgeColor="amber"
					/>
			</section>

			{/* Two columns: Recent activity + Audit log */}
				<section className="mt-8 grid gap-6 lg:grid-cols-2">
					{/* Recent Approval Activity */}
					<div>
						<h2 className="text-lg font-semibold text-white mb-4">最近审批活动</h2>
						{recentRequests.length === 0 ? (
							<EmptyState text="暂无命令请求记录。" />
						) : (
							<div className="space-y-2.5">
								{recentRequests.map((request) => (
									<article key={request.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 hover:bg-white/[0.04] transition-colors duration-150">
										<div className="flex flex-wrap items-center justify-between gap-2">
											<div className="min-w-0 flex-1">
												<h3 className="font-medium text-white text-sm truncate">{request.title}</h3>
												<p className="mt-0.5 text-xs text-slate-500">
													{request.requester.displayName || request.requester.username}
													{request.isAssistantInitiated ? " · 助手" : " · 用户"}
												</p>
											</div>
											<div className="flex items-center gap-1.5 shrink-0">
												<Badge color={request.status === "PENDING_APPROVAL" ? "amber" : request.status === "APPROVED" ? "emerald" : "slate"}>
													{request.approvalStateLabel}
												</Badge>
												<Badge color="slate">目标 {request.targets.length} 台</Badge>
											</div>
										</div>
										<p className="mt-2.5 rounded-lg bg-slate-950/60 px-3 py-1.5 font-mono text-xs text-cyan-100/80 border border-white/[0.04]">
											{request.command}
										</p>
									</article>
								))}
							</div>
						)}
					</div>

					{/* Recent Audit Log */}
					<div>
						<div className="flex items-center justify-between mb-4">
							<h2 className="text-lg font-semibold text-white">最近操作日志</h2>
							<Link href="/audit" className="text-xs text-cyan-400/80 hover:text-cyan-300 transition-colors">查看全部 →</Link>
						</div>
						{recentAuditLogs.length === 0 ? (
							<EmptyState text="暂无审计日志。" />
						) : (
							<div className="space-y-1.5">
								{recentAuditLogs.map((log) => (
									<div key={log.id} className="rounded-lg border border-white/[0.04] bg-white/[0.02] px-3.5 py-2.5 hover:bg-white/[0.04] transition-colors duration-150">
										<div className="flex items-center gap-2 text-xs">
											<Badge color={log.severity === "WARNING" ? "amber" : log.severity === "CRITICAL" ? "rose" : "slate"}>
												{log.action}
											</Badge>
											<span className="text-slate-500 truncate">
												{log.actor?.displayName ?? log.actor?.username ?? (log.actorType === "SYSTEM" ? "系统" : log.actorType)}
											</span>
											<time className="ml-auto text-slate-600 shrink-0" dateTime={log.createdAt.toISOString()} suppressHydrationWarning>
												{formatDashboardAuditDate(log.createdAt)}
											</time>
										</div>
									</div>
								))}
							</div>
						)}
					</div>
				</section>
		</PageShell>
	);
}

function QuickLink({ href, title, desc, icon, badge, badgeColor }: {
	href: string; title: string; desc: string; icon: React.ReactNode; badge?: string; badgeColor?: "cyan" | "amber";
}) {
	const badgeBg = badgeColor === "cyan" ? "bg-cyan-400/10 border-cyan-400/20 text-cyan-200" : "bg-amber-400/10 border-amber-400/20 text-amber-200";
	return (
		<Link
			href={href}
			className="group rounded-xl border border-white/[0.06] bg-white/[0.03] p-5 transition-all duration-150 hover:border-cyan-400/20 hover:bg-cyan-400/[0.04]"
		>
			<div className="text-slate-400 group-hover:text-cyan-300 transition-colors duration-150">{icon}</div>
			<div className="mt-3 text-sm font-medium text-white">{title}</div>
			<p className="mt-1 text-xs text-slate-500">{desc}</p>
			{badge && (
				<span className={`mt-2.5 inline-block rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${badgeBg}`}>
					{badge}
				</span>
			)}
		</Link>
	);
}

function Badge({ color, children }: { color: "amber" | "emerald" | "rose" | "slate"; children: React.ReactNode }) {
	const styles = {
		amber: "border-amber-400/20 bg-amber-400/10 text-amber-200",
		emerald: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
		rose: "border-rose-400/20 bg-rose-400/10 text-rose-200",
		slate: "border-white/10 bg-white/5 text-slate-300",
	};
	return (
		<span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[color]}`}>
			{children}
		</span>
	);
}

