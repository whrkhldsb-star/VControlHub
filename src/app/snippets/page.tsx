import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listSnippets } from "@/lib/snippet/service";
import { PageShell, Card, PermissionDenied } from "@/components/page-shell";
export const dynamic = "force-dynamic";
export default async function Page() {
	const session = await requireSession("/snippets");
	if (!sessionHasPermission(session, "snippet:manage")) return <PermissionDenied />;
	const snippets = await listSnippets({ userId: session.userId });
	return (
		<PageShell>
			<h1 className="text-3xl font-semibold text-white">代码片段库</h1>
			<p className="mt-2 text-sm text-slate-400">沉淀常用脚本、命令和配置片段，支持语言、标签和私有片段。</p>
			<div className="mt-6 grid gap-3">
				{snippets.map((s) => (
					<Card key={s.id}>
						<div className="flex justify-between">
							<b>{s.title}</b>
							<span className="text-xs text-cyan-300">{s.language}</span>
						</div>
						<pre className="mt-3 max-h-48 overflow-auto rounded bg-black/30 p-3 text-xs text-slate-300">{s.content}</pre>
					</Card>
				))}
				{snippets.length === 0 && <Card>暂无代码片段。</Card>}
			</div>
		</PageShell>
	);
}
