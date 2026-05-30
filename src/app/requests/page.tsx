import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getPendingActions } from "@/lib/ai/hosted-service";
import { listCommandRequests } from "@/lib/command/service";
import { ReviewCommandForm } from "./review-command-form";
import { AiHostedApprovalCard } from "./ai-hosted-approval-card";
import { PageShell, StatCard, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
	const session = await requireSession("/requests");
	const canApprove = sessionHasPermission(session, "command:approve");
	const [requests, aiActions] = await Promise.all([
		listCommandRequests(),
		getPendingActions(session.userId),
	]);

	const pendingCommands = requests.filter((r) => r.status === "PENDING_APPROVAL").length;
	const assistantCommands = requests.filter((r) => r.isAssistantInitiated).length;
	const userCommands = requests.filter((r) => !r.isAssistantInitiated).length;
	const completed = requests.filter((r) => r.status === "COMPLETED").length;

	return (
		<PageShell maxW="max-w-7xl">
			<header className="mb-8">
				<div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
					<div>
						<h1 className="text-3xl font-semibold tracking-tight text-white">审批中心</h1>
						<p className="mt-1.5 text-sm text-slate-500">AI 助手授权与用户命令审批</p>
					</div>
					<div className="rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-xs text-slate-400">
						<div className="font-medium text-slate-200">当前支持两条审批链路</div>
						<div className="mt-1">AI 助手托管操作先授权再执行；用户/运维提交的命令请求走命令审批流。</div>
					</div>
				</div>
			</header>

			<section className="grid gap-3 sm:grid-cols-5 mb-8">
				<StatCard label="AI 待授权" value={String(aiActions.length)} accent={aiActions.length > 0} accentColor="cyan" />
				<StatCard label="命令待审批" value={String(pendingCommands)} accent={pendingCommands > 0} accentColor="amber" />
				<StatCard label="助手命令" value={String(assistantCommands)} accent={assistantCommands > 0} accentColor="cyan" />
				<StatCard label="用户命令" value={String(userCommands)} />
				<StatCard label="已完成" value={String(completed)} />
			</section>

			<div className="space-y-8">
				<section aria-labelledby="ai-approval-heading" className="space-y-3">
					<div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<h2 id="ai-approval-heading" className="text-xl font-semibold text-white">AI 助手授权</h2>
							<p className="mt-1 text-sm text-slate-500">用于确认 AI 托管模式下的高风险工具调用，例如重启服务、修改配置、执行命令。</p>
						</div>
						<span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-200">只显示当前账号待处理授权</span>
					</div>
					{aiActions.length === 0 ? (
						<EmptyState text="暂无 AI 助手待授权操作。AI 对话中触发高风险操作时会出现在这里。" variant="boxed" />
					) : (
						<div className="space-y-3">
							{aiActions.map((action) => <AiHostedApprovalCard key={action.id} action={action} />)}
						</div>
					)}
				</section>

				<section aria-labelledby="command-approval-heading" className="space-y-3">
					<div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
						<div>
							<h2 id="command-approval-heading" className="text-xl font-semibold text-white">用户命令审批</h2>
							<p className="mt-1 text-sm text-slate-500">用于审批用户、运维成员或命令模板提交的 VPS 命令请求；也保留 AI 以命令请求形式发起的记录。</p>
						</div>
						<span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-200">批准后进入真实 SSH 执行流</span>
					</div>

					{requests.length === 0 ? (
						<EmptyState text="暂无命令请求记录。" variant="boxed" />
					) : (
						requests.map((request) => (
							<article key={request.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors duration-150">
								<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
									<div className="min-w-0 flex-1">
										<div className="flex flex-wrap items-center gap-2">
											<h3 className="text-lg font-semibold text-white">{request.title}</h3>
											<ApprovalBadge status={request.approvalStateLabel} />
											<InitiatorBadge assistant={request.isAssistantInitiated} />
										</div>
										{canApprove ? (
										<p className="mt-2.5 rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-xs text-cyan-100/80 border border-white/[0.04]">{request.command}</p>
									) : (
										<p className="mt-2.5 rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-xs text-slate-500 border border-white/[0.04]">🔒 仅审批人可查看命令内容</p>
									)}
										{request.reason && <p className="mt-2 text-sm text-slate-400">原因：{request.reason}</p>}
										<p className="mt-1 text-[11px] text-slate-600">申请人：{request.requester.displayName || request.requester.username}</p>
									</div>
									<div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs text-slate-400 shrink-0">
										目标 {request.targets.length} 台
									</div>
								</div>

								<div className="mt-4 grid gap-3 lg:grid-cols-3">
									<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-4">
										<h4 className="text-xs font-medium text-white/60 uppercase tracking-wider mb-3">目标节点</h4>
										<div className="space-y-1.5">
											{request.targets.map((target: (typeof request.targets)[number]) => (
												<div key={target.id} className="rounded-md bg-white/[0.03] border border-white/[0.04] px-3 py-2">
													<div className="text-sm font-medium text-white">{target.server.name}</div>
													<div className="text-[11px] text-slate-500">{target.server.host}:{target.server.port} · {target.status}</div>
												</div>
											))}
										</div>
									</section>

									<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-4">
										<h4 className="text-xs font-medium text-white/60 uppercase tracking-wider mb-3">最新审批</h4>
										{request.latestApproval ? (
											<div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-3 py-2 text-sm">
												<div className={`font-medium ${request.latestApproval.approved ? "text-emerald-300" : "text-rose-300"}`}>
													{request.latestApproval.approved ? "已批准" : "已拒绝"}
												</div>
												<div className="mt-1 text-[11px] text-slate-500">
													{request.latestApproval.approver.displayName || request.latestApproval.approver.username}
												</div>
												{request.latestApproval.comment && <div className="mt-1.5 text-xs text-slate-400">{request.latestApproval.comment}</div>}
											</div>
										) : (
											<p className="text-xs text-slate-500">尚未形成审批记录。</p>
										)}
									</section>

									<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-4">
										<h4 className="text-xs font-medium text-white/60 uppercase tracking-wider mb-3">执行 / worker 记录</h4>
										{request.executionLogs.length > 0 ? (
											<div className="space-y-2">
												{request.executionLogs.map((log: (typeof request.executionLogs)[number], index: number) => (
													<div key={log.id ?? `${request.id}-log-${index}`} className="rounded-md bg-white/[0.03] border border-white/[0.04] px-3 py-2 text-xs text-slate-400">
														<div>{log.summary}</div>
														{log.createdAt && <div className="mt-1 text-[11px] text-slate-600">{new Date(log.createdAt).toLocaleString("zh-CN")}</div>}
													</div>
												))}
											</div>
										) : (
											<p className="text-xs text-slate-500">暂无执行日志。</p>
										)}
									</section>
								</div>

								{canApprove && request.status === "PENDING_APPROVAL" && <ReviewCommandForm commandRequestId={request.id} />}
							</article>
						))
					)}
				</section>
			</div>
		</PageShell>
	);
}

function ApprovalBadge({ status }: { status: string }) {
	const map: Record<string, string> = {
		"待审批": "border-amber-400/20 bg-amber-400/10 text-amber-200",
		"已批准": "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
		"已拒绝": "border-rose-400/20 bg-rose-400/10 text-rose-200",
	};
	const style = map[status] ?? "border-white/10 bg-white/5 text-slate-300";
	return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${style}`}>{status}</span>;
}

function InitiatorBadge({ assistant }: { assistant: boolean }) {
	return (
		<span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${
			assistant ? "border-cyan-400/20 bg-cyan-400/10 text-cyan-200" : "border-white/10 bg-white/5 text-slate-400"
		}`}>
			{assistant ? "助手授权" : "用户审批"}
		</span>
	);
}
