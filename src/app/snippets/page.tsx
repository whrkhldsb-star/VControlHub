import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listSnippets } from "@/lib/snippet/service";
import { PageShell, PermissionDenied } from "@/components/page-shell";
import { SnippetList } from "./snippet-list-client";

export const dynamic = "force-dynamic";

export default async function Page() {
	const session = await requireSession("/snippets");
	if (!sessionHasPermission(session, "snippet:manage")) return <PermissionDenied />;
	const snippets = await listSnippets({ userId: session.userId });

	const serialized = snippets.map((s) => ({
		...s,
	}));

	return (
		<PageShell>
			<h1 className="text-3xl font-semibold text-white light:text-slate-900">代码片段库</h1>
			<p className="mt-2 text-sm text-slate-400 light:text-slate-600">沉淀常用脚本、命令和配置片段，支持语言、标签和私有片段。</p>
			<div className="mt-6">
				<SnippetList snippets={serialized} />
			</div>
		</PageShell>
	);
}
