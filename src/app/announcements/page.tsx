import { requireSession } from "@/lib/auth/require-session";
import { listActiveAnnouncements } from "@/lib/announcement/service";
import { PageShell, Card } from "@/components/page-shell";
export const dynamic = "force-dynamic";
export default async function Page() {
	await requireSession("/announcements");
	const items = await listActiveAnnouncements();
	return (
		<PageShell>
			<h1 className="text-3xl font-semibold text-white">站内公告</h1>
			<p className="mt-2 text-sm text-slate-400">展示当前有效、置顶优先的站内消息。</p>
			<div className="mt-6 grid gap-3">
				{items.map((a) => (
					<Card key={a.id}>
						<div className="flex gap-2">
							<b>{a.title}</b>
							{a.pinned && <span className="text-xs text-amber-300">置顶</span>}
						</div>
						<p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{a.body}</p>
					</Card>
				))}
				{items.length === 0 && <Card>暂无公告。</Card>}
			</div>
		</PageShell>
	);
}
