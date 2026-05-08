import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listDeploymentRuns, listDeploymentTemplates } from "@/lib/deployment/service";
import { prisma } from "@/lib/db";
import { PageShell, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

export default async function DeploymentsPage() {
	const session = await requireSession("/deployments");
	if (!sessionHasPermission(session, "deploy:read")) return <PageShell><EmptyState text="你没有应用部署查看权限。" /></PageShell>;
	const canRun = sessionHasPermission(session, "deploy:run");
	const [runs, templates, servers] = await Promise.all([
		listDeploymentRuns(),
		listDeploymentTemplates(),
		prisma.server.findMany({ where: { enabled: true }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, host: true, username: true } }),
	]);
	const firstTemplate = templates[0];
	return (
		<PageShell>
			<header className="mb-8">
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Deploy</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">应用部署模板</h1>
				<p className="mt-1.5 text-sm text-slate-500">复用命令模板变量渲染和审批链路，形成可审计的应用/服务部署运行记录。</p>
			</header>
			{canRun && (
				<section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h2 className="text-sm font-semibold text-white">发起模板部署</h2>
					<p className="mt-1 text-xs text-slate-500">提交后进入命令审批/执行链路，不会绕过平台审计。</p>
					<form action="/api/deployments" method="post" className="mt-4 grid gap-3">
						<div className="grid gap-3 md:grid-cols-2">
							<select name="templateId" defaultValue={firstTemplate?.id} className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100">
								{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
							</select>
							<input name="reason" maxLength={500} placeholder="部署原因" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" />
						</div>
						<div className="grid gap-2 md:grid-cols-2">
							{servers.map((s) => (
								<label key={s.id} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-black/20 px-3 py-2 text-xs text-slate-300">
									<input type="checkbox" name="serverIds" value={s.id} />
									<span>{s.name} · {s.username}@{s.host}</span>
								</label>
							))}
						</div>
						<p className="text-xs text-slate-500">模板变量可通过 API 的 variables 字段提交；页面表单先覆盖模板、目标 VPS 与原因，适合常用无变量模板。</p>
						<button className="w-fit rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">提交部署审批</button>
					</form>
				</section>
			)}
			<section className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
				<div className="border-b border-white/[0.06] px-5 py-4 text-sm font-semibold text-white">部署运行</div>
				<div className="divide-y divide-white/[0.06]">
					{runs.length === 0 ? <EmptyState text="暂无部署运行记录" /> : runs.map((r) => (
						<div key={r.id} className="px-5 py-4">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="text-sm font-medium text-white">{r.template.name}</h3>
									<p className="mt-1 text-xs text-slate-500">目标 {r.serverIds.length} 台 · {r.createdAt.toLocaleString("zh-CN")} · 审批 {r.commandRequestId || "待创建"}</p>
								</div>
								<span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400">{r.status}</span>
							</div>
							<code className="mt-3 block overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">{r.renderedCommand}</code>
							{r.errorMessage && <p className="mt-2 text-xs text-rose-300">{r.errorMessage}</p>}
						</div>
					))}
				</div>
			</section>
		</PageShell>
	);
}
