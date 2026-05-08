import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listTickets } from "@/lib/ticket/service";
import { PageShell, Card, PermissionDenied } from "@/components/page-shell";
export const dynamic = "force-dynamic";
export default async function Page() {
	const session = await requireSession("/tickets");
	if (!sessionHasPermission(session, "ticket:manage")) return <PermissionDenied />;
	const tickets = await listTickets(session.userId);
	return (
		<PageShell>
			<h1 className="text-3xl font-semibold text-white">工单与请求</h1>
			<p className="mt-2 text-sm text-slate-400">用于提交资源申请、问题反馈和运维请求，支持状态流转与评论。</p>
			<div className="mt-6 grid gap-3">
				{tickets.map((t) => (
					<Card key={t.id}>
						<div className="flex justify-between">
							<b>{t.title}</b>
							<span className="text-xs text-slate-400">{t.status} · {t.priority}</span>
						</div>
						<p className="mt-2 text-sm text-slate-300">{t.description}</p>
					</Card>
				))}
				{tickets.length === 0 && <Card>暂无工单。</Card>}
			</div>
		</PageShell>
	);
}
