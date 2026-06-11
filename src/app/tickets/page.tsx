import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listTickets } from "@/lib/ticket/service";
import { PageShell, EmptyState } from "@/components/page-shell";
import { CreateTicketForm } from "./create-ticket-form";
import Link from "next/link";

export const dynamic = "force-dynamic";

const priorityLabels: Record<string, string> = {
	LOW: "低",
	NORMAL: "普通",
	HIGH: "高",
	URGENT: "紧急",
};

const statusTone: Record<string, string> = {
	OPEN: "border-cyan-400/30 bg-cyan-400/10 text-cyan-100",
	IN_PROGRESS: "border-amber-400/30 bg-amber-400/10 text-amber-100",
	RESOLVED: "border-emerald-400/30 bg-emerald-400/10 text-emerald-100",
	CLOSED: "border-slate-400/30 bg-slate-400/10 text-slate-300",
};

const statusLabels: Record<string, string> = {
	OPEN: "待处理",
	IN_PROGRESS: "处理中",
	RESOLVED: "已解决",
	CLOSED: "已关闭",
};

export default async function Page() {
	const session = await requireSession("/tickets");
	const canManage = sessionHasPermission(session, "ticket:manage");
	const canCreate = sessionHasPermission(session, "ticket:create");
	const tickets = await listTickets(canManage ? undefined : session.userId);
	return (
		<PageShell maxW="max-w-4xl">
			<header className="mb-6">
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Support</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">工单与请求</h1>
				<p className="mt-1.5 text-sm text-slate-500">提交资源申请、问题反馈和运维请求，支持状态流转与评论。</p>
			</header>

			{canCreate && <div className="mb-6"><CreateTicketForm /></div>}

			<section data-card className="">
				<div className="border-b border-white/[0.06] px-5 py-4 text-sm font-semibold text-white">工单列表 ({tickets.length})</div>
				<div className="divide-y divide-white/[0.06]">
					{tickets.length === 0 ? <EmptyState text="暂无工单" /> : tickets.map((t) => (
						<Link key={t.id} href={`/tickets/${t.id}`} className="block px-5 py-4 transition hover:bg-white/[0.02]"> <div className="flex items-center justify-between gap-3"> <h3 className="text-sm font-medium text-white">{t.title}</h3> <div className="flex items-center gap-2"> <span className="text-xs text-slate-500">{priorityLabels[t.priority] ?? t.priority}</span> <span className={`rounded-full border px-2.5 py-1 text-xs ${statusTone[t.status] ?? "border-white/[0.08] text-slate-400"}`}>
										{statusLabels[t.status] ?? t.status}
									</span>
								</div>
							</div>
							<p className="mt-1.5 text-xs text-slate-400 line-clamp-2">{t.description}</p>
							<div className="mt-2 flex flex-wrap gap-x-3 text-xs text-slate-500">
								{t.creator && <span>提交人: {t.creator.displayName || t.creator.username}</span>}
								{t.assignee && <span>处理人: {t.assignee.displayName || t.assignee.username}</span>}
								<span>创建: {new Date(t.createdAt).toLocaleString("zh-CN")}</span>
							</div>
						</Link>
					))}
				</div>
			</section>
		</PageShell>
	);
}
