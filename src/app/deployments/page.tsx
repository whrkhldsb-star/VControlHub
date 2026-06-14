import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listDeploymentRuns, listDeploymentTemplates } from "@/lib/deployment/service";
import { prisma } from "@/lib/db";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { DeploymentLaunchForm } from "./deployment-launch-form";
import { DeploymentExportPanel } from "./deployment-export-panel";
import { ResendDeployButton } from "./resend-deploy-button";
import { RollbackDeployButton } from "./rollback-deploy-button";

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
			<PageHeader eyebrow="Deploy" title="应用部署" description="选择部署模板 → 填写变量 → 选择目标 VPS → 提交审批 → 自动执行。" />

			{/* How it works */}
			<section data-tone="cyan" className="mb-6 rounded-xl border border-cyan-400/20 p-5">
				<h2 className="text-sm font-semibold text-white mb-3">💡 使用流程</h2>
				<div className="grid gap-2 text-xs text-[var(--text-secondary)] md:grid-cols-5">
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
				<p className="mt-3 text-xs text-slate-500">每次部署都会保存不可变快照；配置了回滚命令的模板可执行真实回滚，未配置时仍可按原模板重发。所有操作经过审批链路，确保可审计。</p>
			</section>
			{formError && (
				<div role="alert" data-tone="rose" className="mb-6 rounded-xl border border-rose-400/20 px-4 py-3 text-sm text-rose-200">
					部署提交失败：{formError}
				</div>
			)}
			{canExport && <DeploymentExportPanel />}
			{canRun && (
				<section data-card className="mb-6  p-5">
					<h2 className="text-sm font-semibold text-white">发起模板部署</h2>
					<p className="mt-1 text-xs text-slate-500">选择模板后填写变量和目标 VPS。提交后进入命令审批/执行链路，不会绕过平台审计。</p>
					<DeploymentLaunchForm templates={templates} servers={servers} />
				</section>
			)}
			{canRun && latestRun && (
				<section data-tone="emerald" className="mb-6 rounded-xl border border-emerald-400/20 p-5">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200/70">真实回滚</p>
							<h2 className="mt-1 text-sm font-semibold text-white">最近部署：{latestRun.template.name}</h2>
							<p className="mt-1 text-xs text-[var(--text-secondary)]">目标 {latestRun.serverIds.length} 台 · {latestRun.createdAt.toLocaleString("zh-CN")} · 快照 {latestRun.snapshotId || "待生成"}</p>
						</div>
						<span className={`rounded-full border px-2.5 py-1 text-xs ${deploymentStatusTone(latestRun.status)}`}>{latestRun.status}</span>
					</div>
					<code className="mt-4 block max-h-24 overflow-auto rounded-lg border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-xs text-slate-300">{latestRun.snapshot?.rollbackCommand || "该部署快照没有回滚命令，可使用重发作为兼容操作。"}</code>
					<div className="mt-4 flex flex-wrap items-center gap-3">
						<RollbackDeployButton runId={latestRun.id} templateName={latestRun.template.name} disabled={!latestRun.snapshot?.rollbackCommand} />
						<ResendDeployButton
							templateId={latestRun.templateId}
							variables={latestRun.variables as Record<string, string> | null}
							serverIds={latestRun.serverIds}
							reason={`重新提交部署：${latestRun.template.name}`}
							label="重新提交部署"
						/>
						<span className="text-xs text-slate-500">真实回滚执行快照中的 rollback command；重新提交部署会再次执行原模板。</span>
					</div>
				</section>
			)}
			<section data-card className="">
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
							<code className="mt-3 block overflow-auto rounded-lg border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-xs text-slate-300">{r.renderedCommand}</code>
							{r.snapshot?.rollbackCommand && <code data-tone="emerald" className="mt-2 block overflow-auto rounded-lg border border-emerald-400/20 p-3 font-mono text-xs text-emerald-100 light:border-emerald-200 light:bg-emerald-50">Rollback: {r.snapshot.rollbackCommand}</code>}
							{r.rollbackAttempts?.length > 0 && (
								<div data-tone="emerald" className="mt-2 rounded-lg border border-emerald-400/20 px-3 py-2 text-xs text-emerald-100">
									最近回滚：{r.rollbackAttempts[0]!.status} · 审批 {r.rollbackAttempts[0]!.commandRequestId || "待创建"} · {r.rollbackAttempts[0]!.createdAt.toLocaleString("zh-CN")}
								</div>
							)}
							{r.errorMessage && <p className="mt-2 text-xs text-rose-300">{r.errorMessage}</p>}
							{canRun && (
								<div className="mt-3 flex flex-wrap gap-2">
									<RollbackDeployButton runId={r.id} templateName={r.template.name} disabled={!r.snapshot?.rollbackCommand} />
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
