import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listDeploymentRuns, listDeploymentTemplates } from "@/lib/deployment/service";
import { prisma } from "@/lib/db";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { DeploymentLaunchForm } from "./deployment-launch-form";
import { DeploymentExportPanel } from "./deployment-export-panel";
import { ResendDeployButton } from "./resend-deploy-button";
import { RollbackDeployButton } from "./rollback-deploy-button";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

function deploymentStatusTone(status: string) {
	if (["COMPLETED", "SUCCESS", "SUCCEEDED"].includes(status)) return "border-emerald-400/30 bg-emerald-400/10 text-emerald-100";
	if (["FAILED", "CANCELLED", "REJECTED"].includes(status)) return "border-rose-400/30 bg-rose-400/10 text-rose-100";
	if (["RUNNING", "APPROVED"].includes(status)) return "border-cyan-400/30 bg-cyan-400/10 text-cyan-100";
	return "border-amber-400/30 bg-amber-400/10 text-amber-100";
}

export default async function DeploymentsPage({ searchParams }: { searchParams?: Promise<{ error?: string }> }) {

	const session = await requireSession("/deployments");
	const locale = await getServerLocale();
	const tr = (key: string) => t(key, locale);
	const trTpl = (key: string, vars: Record<string, string>) =>
		Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), tr(key));
	if (!sessionHasPermission(session, "deploy:read")) return <PageShell><EmptyState text={tr("deploymentsPage.page.noPermission")} /></PageShell>;
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
			<PageHeader eyebrow={tr("deploymentsPage.page.eyebrow")} title={tr("deploymentsPage.page.title")} description={tr("deploymentsPage.page.description")} />

			{/* How it works */}
			<section data-tone="cyan" className="mb-6 rounded-xl border border-cyan-400/20 p-5">
				<h2 className="text-sm font-semibold text-[var(--text-primary)] mb-3">{tr("deploymentsPage.page.howItWorks.title")}</h2>
				<div className="grid gap-2 text-xs text-[var(--text-secondary)] md:grid-cols-5">
					<div className="rounded-lg border border-[var(--border)] bg-black/20 p-3 text-center">
						<div className="text-lg mb-1">📝</div>
						<div className="font-medium text-[var(--text-primary)]">{tr("deploymentsPage.page.howItWorks.step1.title")}</div>
						<div className="mt-1">{tr("deploymentsPage.page.howItWorks.step1.desc").replace("{{变量名}}", "{{variable}}")}</div>
					</div>
					<div className="rounded-lg border border-[var(--border)] bg-black/20 p-3 text-center">
						<div className="text-lg mb-1">🎯</div>
						<div className="font-medium text-[var(--text-primary)]">{tr("deploymentsPage.page.howItWorks.step2.title")}</div>
						<div className="mt-1">{tr("deploymentsPage.page.howItWorks.step2.desc")}</div>
					</div>
					<div className="rounded-lg border border-[var(--border)] bg-black/20 p-3 text-center">
						<div className="text-lg mb-1">⚙️</div>
						<div className="font-medium text-[var(--text-primary)]">{tr("deploymentsPage.page.howItWorks.step3.title")}</div>
						<div className="mt-1">{tr("deploymentsPage.page.howItWorks.step3.desc")}</div>
					</div>
					<div className="rounded-lg border border-[var(--border)] bg-black/20 p-3 text-center">
						<div className="text-lg mb-1">🖥️</div>
						<div className="font-medium text-[var(--text-primary)]">{tr("deploymentsPage.page.howItWorks.step4.title")}</div>
						<div className="mt-1">{tr("deploymentsPage.page.howItWorks.step4.desc")}</div>
					</div>
					<div className="rounded-lg border border-[var(--border)] bg-black/20 p-3 text-center">
						<div className="text-lg mb-1">🚀</div>
						<div className="font-medium text-[var(--text-primary)]">{tr("deploymentsPage.page.howItWorks.step5.title")}</div>
						<div className="mt-1">{tr("deploymentsPage.page.howItWorks.step5.desc")}</div>
					</div>
				</div>
				<p className="mt-3 text-xs text-[var(--text-muted)]">{tr("deploymentsPage.page.howItWorks.auditNote")}</p>
			</section>
			{formError && (
				<div role="alert" data-tone="rose" className="mb-6 rounded-xl border border-rose-400/20 px-4 py-3 text-sm text-rose-200">
					{tr("deploymentsPage.page.submitFailed")}{formError}
				</div>
			)}
			{canExport && <DeploymentExportPanel />}
			{canRun && (
				<section data-card className="mb-6 ">
					<h2 className="text-sm font-semibold text-[var(--text-primary)]">{tr("deploymentsPage.page.launchSection.title")}</h2>
					<p className="mt-1 text-xs text-[var(--text-muted)]">{tr("deploymentsPage.page.launchSection.desc")}</p>
					<DeploymentLaunchForm templates={templates} servers={servers} />
				</section>
			)}
			{canRun && latestRun && (
				<section data-tone="emerald" className="mb-6 rounded-xl border border-emerald-400/20 p-5">
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-200/70">{tr("deploymentsPage.page.latestDeploy.eyebrow")}</p>
							<h2 className="mt-1 text-sm font-semibold text-[var(--text-primary)]">{tr("deploymentsPage.page.latestDeploy.heading")}{latestRun.template.name}</h2>
							<p className="mt-1 text-xs text-[var(--text-secondary)]">{trTpl("deploymentsPage.page.latestDeploy.meta", { count: String(latestRun.serverIds.length), date: latestRun.createdAt.toLocaleString("zh-CN"), snapshot: latestRun.snapshotId || tr("deploymentsPage.page.latestDeploy.snapshotPending") })}</p>
						</div>
						<span className={`rounded-full border px-2.5 py-1 text-xs ${deploymentStatusTone(latestRun.status)}`}>{latestRun.status}</span>
					</div>
					<code className="mt-4 block max-h-24 overflow-auto rounded-lg border border-[var(--border)] bg-slate-950/70 p-3 font-mono text-xs text-[var(--text-secondary)]">{latestRun.snapshot?.rollbackCommand || tr("deploymentsPage.page.latestDeploy.noRollback")}</code>
					<div className="mt-4 flex flex-wrap items-center gap-3">
						<RollbackDeployButton runId={latestRun.id} templateName={latestRun.template.name} disabled={!latestRun.snapshot?.rollbackCommand} />
						<ResendDeployButton
							templateId={latestRun.templateId}
							variables={latestRun.variables as Record<string, string> | null}
							serverIds={latestRun.serverIds}
							reason={`重新提交部署：${latestRun.template.name}`}
							label={tr("deploymentsPage.launch.title")}
						/>
						<span className="text-xs text-[var(--text-muted)]">{tr("deploymentsPage.page.latestDeploy.help")}</span>
					</div>
				</section>
			)}
			<section data-card className="">
				<div className="border-b border-[var(--border)] px-5 py-4 text-sm font-semibold text-[var(--text-primary)]">{tr("deploymentsPage.page.runsSection.title")}</div>
				<div className="divide-y divide-[var(--border)]">
					{runs.length === 0 ? <EmptyState text={tr("deploymentsPage.page.runsSection.empty")} /> : runs.map((r) => (
						<div key={r.id} className="px-5 py-4">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="text-sm font-medium text-[var(--text-primary)]">{r.template.name}</h3>
									<p className="mt-1 text-xs text-[var(--text-muted)]">{trTpl("deploymentsPage.page.runsSection.meta", { count: String(r.serverIds.length), date: r.createdAt.toLocaleString("zh-CN"), request: r.commandRequestId || tr("deploymentsPage.page.runsSection.requestPending") })}</p>
								</div>
								<span className={`rounded-lg border px-2 py-1 text-xs ${deploymentStatusTone(r.status)}`}>{r.status}</span>
							</div>
							<code className="mt-3 block overflow-auto rounded-lg border border-[var(--border)] bg-slate-950/70 p-3 font-mono text-xs text-[var(--text-secondary)]">{r.renderedCommand}</code>
							{r.snapshot?.rollbackCommand && <code data-tone="emerald" className="mt-2 block overflow-auto rounded-lg border border-emerald-400/20 p-3 font-mono text-xs text-emerald-100 light:border-emerald-200 light:bg-emerald-50">{tr("deploymentsPage.page.runsSection.rollback")}{r.snapshot.rollbackCommand}</code>}
							{r.rollbackAttempts?.length > 0 && (
								<div data-tone="emerald" className="mt-2 rounded-lg border border-emerald-400/20 px-3 py-2 text-xs text-emerald-100">
									{trTpl("deploymentsPage.page.runsSection.rollbackMeta", { status: r.rollbackAttempts[0]!.status, request: r.rollbackAttempts[0]!.commandRequestId || tr("deploymentsPage.page.runsSection.requestPending"), date: r.rollbackAttempts[0]!.createdAt.toLocaleString("zh-CN") })}
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
