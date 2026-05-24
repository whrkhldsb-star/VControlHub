import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listDeploymentRuns, listDeploymentTemplates, createDeploymentRunFromTemplate } from "@/lib/deployment/service";
import { prisma } from "@/lib/db";
import { PageShell, EmptyState } from "@/components/page-shell";

export const dynamic = "force-dynamic";

function deploymentStatusTone(status: string) {
	if (["COMPLETED", "SUCCESS", "SUCCEEDED"].includes(status)) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
	if (["FAILED", "CANCELLED", "REJECTED"].includes(status)) return "border-rose-400/30 bg-rose-400/10 text-rose-100";
	if (["RUNNING", "APPROVED"].includes(status)) return "border-cyan-400/30 bg-cyan-400/10 text-cyan-100";
	return "border-amber-400/30 bg-amber-400/10 text-amber-100";
}

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
	const latestRun = runs[0];
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
			{canRun && latestRun && (
				<section className="mb-6 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-5">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200/70">快速回退</p>
							<h2 className="mt-1 text-sm font-semibold text-white">最近部署：{latestRun.template.name}</h2>
							<p className="mt-1 text-xs text-slate-400">目标 {latestRun.serverIds.length} 台 · {latestRun.createdAt.toLocaleString("zh-CN")} · 审批 {latestRun.commandRequestId || "待创建"}</p>
						</div>
						<span className={`rounded-full border px-2.5 py-1 text-xs ${deploymentStatusTone(latestRun.status)}`}>{latestRun.status}</span>
					</div>
					<code className="mt-4 block max-h-24 overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">{latestRun.renderedCommand}</code>
					<form action="/api/deployments" method="post" className="mt-4 flex flex-wrap items-center gap-2">
						<input type="hidden" name="templateId" value={latestRun.templateId} />
						<input type="hidden" name="variablesJson" value={JSON.stringify(latestRun.variables)} />
						<input type="hidden" name="reason" value={`快速回退重发：${latestRun.template.name}`} />
						{latestRun.serverIds.map((id) => <input key={id} type="hidden" name="serverIds" value={id} />)}
						<button className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300">重发最近部署</button>
						<span className="text-xs text-slate-500">会重新进入审批链路并保留审计记录。</span>
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
								<span className={`rounded-md border px-2 py-1 text-xs ${deploymentStatusTone(r.status)}`}>{r.status}</span>
							</div>
							<code className="mt-3 block overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">{r.renderedCommand}</code>
							{r.errorMessage && <p className="mt-2 text-xs text-rose-300">{r.errorMessage}</p>}
							{canRun && (
								<form action="/api/deployments" method="post" className="mt-3 flex flex-wrap items-center gap-2">
									<input type="hidden" name="templateId" value={r.templateId} />
									<input type="hidden" name="variablesJson" value={JSON.stringify(r.variables)} />
									<input type="hidden" name="reason" value={`回退重发：${r.template.name}`} />
									{r.serverIds.map((id) => <input key={id} type="hidden" name="serverIds" value={id} />)}
									<button className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/15">按此记录重发</button>
								</form>
							)}
						</div>
					))}
				</div>
			</section>
		</PageShell>
	);
}
