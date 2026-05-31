import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listDeploymentRuns, listDeploymentTemplates } from "@/lib/deployment/service";
import { prisma } from "@/lib/db";
import { PageShell, EmptyState } from "@/components/page-shell";
import { DeploymentLaunchForm } from "./deployment-launch-form";
import { DeploymentExportPanel } from "./deployment-export-panel";
import { ResendDeployButton } from "./resend-deploy-button";

export const dynamic = "force-dynamic";

function deploymentStatusTone(status: string) {
	if (["COMPLETED", "SUCCESS", "SUCCEEDED"].includes(status)) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
	if (["FAILED", "CANCELLED", "REJECTED"].includes(status)) return "border-rose-400/30 bg-rose-400/10 text-rose-100";
	if (["RUNNING", "APPROVED"].includes(status)) return "border-cyan-400/30 bg-cyan-400/10 text-cyan-100";
	return "border-amber-400/30 bg-amber-400/10 text-amber-100";
}

export default async function DeploymentsPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {

	const session = await requireSession("/deployments");
	if (!sessionHasPermission(session, "deploy:read")) return <PageShell><EmptyState text="你没有应用部署查看权限。" /></PageShell>;
	const canRun = sessionHasPermission(session, "deploy:run");
	const canExport = sessionHasPermission(session, "deploy:export");
	const params = await searchParams;
	const formError = params?.error;
	const [runs, templates, servers] = await Promise.all([
		listDeploymentRuns(),
		listDeploymentTemplates(),
		prisma.server.findMany({ where: { enabled: true }, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, name: true, host: true, username: true } }),
	]);
	const latestRun = runs[0];
	return (
		<PageShell>
			<header className="mb-8">
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Deploy</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">应用部署</h1>
				<p className="mt-1.5 text-sm text-slate-500">选择部署模板 → 填写变量 → 选择目标 VPS → 提交审批 → 自动执行。</p>
			</header>

			{/* How it works */}
			<section className="mb-6 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.04] p-5">
				<h2 className="text-sm font-semibold text-white mb-3">💡 使用流程</h2>
				<div className="grid gap-2 text-xs text-slate-400 md:grid-cols-5">
					<div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 text-center">
						<div className="text-lg mb-1">📝</div>
						<div className="font-medium text-white">1. 创建模板</div>
						<div className="mt-1">在「命令模板」页面创建带 <code className="text-cyan-300">{"{{变量名}}"}</code> 的部署脚本</div>
					</div>
					<div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 text-center">
						<div className="text-lg mb-1">🎯</div>
						<div className="font-medium text-white">2. 选择模板</div>
						<div className="mt-1">在下方选择你要部署的模板</div>
					</div>
					<div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 text-center">
						<div className="text-lg mb-1">⚙️</div>
						<div className="font-medium text-white">3. 填写变量</div>
						<div className="mt-1">填写模板所需的变量值（如版本号、端口等）</div>
					</div>
					<div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 text-center">
						<div className="text-lg mb-1">🖥️</div>
						<div className="font-medium text-white">4. 选择 VPS</div>
						<div className="mt-1">勾选要部署到的目标服务器</div>
					</div>
					<div className="rounded-lg border border-white/[0.06] bg-black/20 p-3 text-center">
						<div className="text-lg mb-1">🚀</div>
						<div className="font-medium text-white">5. 提交审批</div>
						<div className="mt-1">进入审批链路，审批通过后自动执行并记录日志</div>
					</div>
				</div>
				<p className="mt-3 text-xs text-slate-500">每次部署都会生成唯一的运行记录，支持一键重发回退。所有操作经过审批链路，确保可审计。</p>
			</section>
			{formError && (
				<div role="alert" className="mb-6 rounded-xl border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-200">
					部署提交失败：{formError}
				</div>
			)}
			{canExport && <DeploymentExportPanel />}
			{canRun && (
				<section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5 light:border-slate-200 light:bg-white">
					<h2 className="text-sm font-semibold text-white light:text-slate-900">发起模板部署</h2>
					<p className="mt-1 text-xs text-slate-500 light:text-slate-600">选择模板后填写变量和目标 VPS。提交后进入命令审批/执行链路，不会绕过平台审计。</p>
					<DeploymentLaunchForm templates={templates} servers={servers} />
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
					<div className="mt-4">
						<ResendDeployButton
							templateId={latestRun.templateId}
							variables={latestRun.variables as Record<string, string> | null}
							serverIds={latestRun.serverIds}
							reason={`快速回退重发：${latestRun.template.name}`}
							label="重发最近部署"
						/>
						<span className="mt-2 block text-xs text-slate-500">会重新进入审批链路并保留审计记录。</span>
					</div>
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
								<div className="mt-3">
									<ResendDeployButton
										templateId={r.templateId}
										variables={r.variables as Record<string, string> | null}
										serverIds={r.serverIds}
										reason={`回退重发：${r.template.name}`}
										label="按此记录重发"
									/>
								</div>
							)}
						</div>
					))}
				</div>
			</section>
		</PageShell>
	);
}
