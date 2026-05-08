import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listCommandRequests } from "@/lib/command/service";
import { ReviewCommandForm } from "./review-command-form";
import { PageShell, StatCard, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function RequestsPage() {
	const session = await requireSession("/requests");
	const canApprove = sessionHasPermission(session, "command:approve");
	const requests = await listCommandRequests();

	const pending = requests.filter((r) => r.status === "PENDING_APPROVAL").length;
	const assistantCount = requests.filter((r) => r.isAssistantInitiated).length;
	const completed = requests.filter((r) => r.status === "COMPLETED").length;

	return (
		<PageShell maxW="max-w-7xl">
			<header className="mb-8">
				<h1 className="text-3xl font-semibold tracking-tight text-white">审批中心</h1>
				<p className="mt-1.5 text-sm text-slate-500">命令请求与审批链路</p>
			</header>

			<section className="grid gap-3 sm:grid-cols-4 mb-8">
				<StatCard label="请求总数" value={String(requests.length)} />
				<StatCard label="待审批" value={String(pending)} accent={pending > 0} accentColor="amber" />
				<StatCard label="助手发起" value={String(assistantCount)} accent={assistantCount > 0} accentColor="cyan" />
				<StatCard label="已完成" value={String(completed)} />
			</section>

			<section className="space-y-3">
				{requests.length === 0 ? (
					<EmptyState text="暂无命令请求记录。" variant="boxed" />
				) : (
					requests.map((request) => (
						<article key={request.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 hover:bg-white/[0.04] transition-colors duration-150">
							<div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
								<div className="min-w-0 flex-1">
									<div className="flex flex-wrap items-center gap-2">
										<h2 className="text-lg font-semibold text-white">{request.title}</h2>
										<ApprovalBadge status={request.approvalStateLabel} />
										<InitiatorBadge assistant={request.isAssistantInitiated} />
									</div>
									<p className="mt-2.5 rounded-lg bg-slate-950/60 px-3 py-2 font-mono text-xs text-cyan-100/80 border border-white/[0.04]">{request.command}</p>
									{request.reason && <p className="mt-2 text-sm text-slate-400">原因：{request.reason}</p>}
									<p className="mt-1 text-[11px] text-slate-600">申请人：{request.requester.displayName || request.requester.username}</p>
								</div>
								<div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs text-slate-400 shrink-0">
									目标 {request.targets.length} 台
								</div>
							</div>

							<div className="mt-4 grid gap-3 lg:grid-cols-3">
								<section className="rounded-lg border border-white/[0.04] bg-slate-950/40 p-4">
									<h3 className="text-xs font-medium text-white/60 uppercase tracking-wider mb-3">目标节点</h3>
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
									<h3 className="text-xs font-medium text-white/60 uppercase tracking-wider mb-3">最新审批</h3>
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
									<h3 className="text-xs font-medium text-white/60 uppercase tracking-wider mb-3">执行日志</h3>
									{request.latestLog ? (
										<div className="rounded-md bg-white/[0.03] border border-white/[0.04] px-3 py-2 text-xs text-slate-400">{request.latestLog.summary}</div>
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
			{assistant ? "助手" : "用户"}
		</span>
	);
}
