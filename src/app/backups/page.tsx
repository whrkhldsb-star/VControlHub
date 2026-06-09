import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { buildBackupRestoreCommand, buildPortableBackupCommand, buildScheduledBackupCommand, formatBackupSize, isBackupType, listBackupRecords, summarizeBackupPolicy } from "@/lib/backup/service";
import { listServerProfiles } from "@/lib/server/service";
import { PageShell, EmptyState } from "@/components/page-shell";
import { CreateBackupForm } from "./create-backup-form";
import { ScheduleBackupForm } from "./schedule-backup-form";
import { RestoreBackupButton } from "./restore-backup-button";
import { RetryBackupRecordButton } from "./retry-backup-record-button";
import { VoidBackupRecordButton } from "./void-backup-record-button";
import { formatZhDateTime } from "@/lib/datetime/format";

export const dynamic = "force-dynamic";

const projectRoot = process.env.APP_DIR || process.cwd();

export default async function BackupsPage() {
	const session = await requireSession("/backups");
	if (!sessionHasPermission(session, "backup:read")) return <PageShell><EmptyState text="你没有备份管理查看权限。" /></PageShell>;
	const canCreate = sessionHasPermission(session, "backup:create");
	const canRestore = sessionHasPermission(session, "backup:restore");
	const [backups, servers] = await Promise.all([listBackupRecords(), listServerProfiles()]);
	const summary = summarizeBackupPolicy(backups);
	const serverOptions = servers.map((server) => ({ id: server.id, name: server.name, enabled: server.enabled }));
	const scheduledCommandByType = {
		DATABASE: buildScheduledBackupCommand({ projectRoot, type: "DATABASE" }),
		FILES: buildScheduledBackupCommand({ projectRoot, type: "FILES" }),
		FULL: buildScheduledBackupCommand({ projectRoot, type: "FULL" }),
	};
	return (
		<PageShell>
			<header className="mb-8">
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300 light:text-cyan-700/70">Portable</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white light:text-slate-900">备份与迁移</h1>
				<p className="mt-1.5 text-sm text-slate-500">记录数据库/文件/完整备份，配合 deploy/backup.sh 与 restore-db.sh 支持迁移到其他系统。恢复命令只展示，不会绕过审批直接执行。</p>
			</header>

			<section className="mb-6 grid gap-3 md:grid-cols-4">
				<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
					<p className="text-xs text-slate-500">完成备份</p>
					<p className="mt-1 text-2xl font-semibold text-white light:text-slate-900">{summary.completedRecords}</p>
					<p className="mt-1 text-xs text-slate-500">共 {summary.totalRecords} 条记录</p>
				</div>
				<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
					<p className="text-xs text-slate-500">已用备份空间</p>
					<p className="mt-1 text-2xl font-semibold text-white light:text-slate-900">{formatBackupSize(summary.totalCompletedSizeBytes)}</p>
					<p className="mt-1 text-xs text-slate-500">最大：{summary.largestCompleted ? `${summary.largestCompleted.type} · ${formatBackupSize(summary.largestCompleted.sizeBytes)}` : "暂无"}</p>
				</div>
				<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
					<p className="text-xs text-slate-500">保留策略提示</p>
					<p className="mt-1 text-2xl font-semibold text-white light:text-slate-900">{summary.recordsOlderThan30Days}</p>
					<p className="mt-1 text-xs text-slate-500">条完成备份超过 30 天，建议复核清理</p>
				</div>
				<div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
					<p className="text-xs text-slate-500">异常/执行中</p>
					<p className="mt-1 text-2xl font-semibold text-white light:text-slate-900">{summary.failedRecords} / {summary.runningRecords}</p>
					<p className="mt-1 text-xs text-slate-500">失败 / PENDING+RUNNING</p>
				</div>
			</section>

			<section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-sm font-semibold text-white light:text-slate-900">备份策略概览</h2>
						<p className="mt-1 text-xs text-slate-500">按备份类型汇总数量和容量，辅助规划定时备份、异地备份与保留策略。</p>
					</div>
					<p className="text-xs text-slate-500">最近完成：{formatZhDateTime(summary.latestCompletedAt, "暂无")}</p>
				</div>
				<div className="mt-4 grid gap-3 md:grid-cols-3">
					{(["DATABASE", "FILES", "FULL"] as const).map((type) => (
						<div key={type} className="rounded-lg border border-white/[0.06] bg-black/10 p-3 light:bg-white/50">
							<p className="text-xs font-semibold text-cyan-200 light:text-cyan-700">{type}</p>
							<p className="mt-1 text-sm text-white light:text-slate-900">{summary.byType[type].count} 个 · {formatBackupSize(summary.byType[type].sizeBytes)}</p>
						</div>
					))}
				</div>
			</section>

			<section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
				<div className="flex flex-wrap items-start justify-between gap-4">
					<div>
						<h2 className="text-sm font-semibold text-white light:text-slate-900">备份失败原因聚合</h2>
						<p className="mt-1 text-xs text-slate-500">按最近 200 条备份记录中的 FAILED 错误文本归类，优先定位路径、权限、超时、存储空间或脚本执行问题。</p>
					</div>
					<p className="text-xs text-slate-500">失败记录：{summary.failedRecords}</p>
				</div>
				{summary.failureSummary.length === 0 ? (
					<p className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-200 light:text-emerald-700">暂无失败备份记录。</p>
				) : (
					<div className="mt-4 grid gap-3 md:grid-cols-2">
						{summary.failureSummary.map((item) => (
							<div key={item.category} className="rounded-lg border border-rose-400/20 bg-rose-400/10 p-3 light:bg-rose-50">
								<div className="flex items-center justify-between gap-3">
									<p className="text-xs font-semibold text-rose-200 light:text-rose-700">{item.label}</p>
									<span className="rounded-full bg-rose-400/15 px-2 py-0.5 text-xs text-rose-100 light:text-rose-700">{item.count} 条</span>
								</div>
								{item.latestRecordPath && <p className="mt-2 text-xs text-slate-500">最新记录：{item.latestRecordPath}</p>}
								<p className="mt-2 rounded-md border border-white/[0.06] bg-black/10 px-2 py-1.5 text-xs text-slate-300 light:border-slate-200 light:bg-white/60 light:text-slate-700">建议：{item.remediation}</p>
								{item.latestMessage && <p className="mt-1 line-clamp-2 text-xs text-slate-400 light:text-slate-600">{item.latestMessage}</p>}
							</div>
						))}
					</div>
				)}
			</section>

			{canCreate && (
				<section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h2 className="text-sm font-semibold text-white light:text-slate-900">创建并执行备份</h2>
					<p className="mt-1 text-xs text-slate-500">提交后会创建可审计备份记录并排入 Durable Job 后台队列；页面可刷新查看 PENDING/RUNNING/COMPLETED 或 FAILED 状态。</p>
					<CreateBackupForm />
				</section>
			)}

			{canCreate && (
				<section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h2 className="text-sm font-semibold text-white light:text-slate-900">创建定时备份</h2>
					<p className="mt-1 text-xs text-slate-500">选择备份类型、Cron 与执行节点后，会创建一条可审计的定时任务；后续执行日志可在“定时任务”页面追踪。</p>
					<ScheduleBackupForm servers={serverOptions} commandByType={scheduledCommandByType} />
				</section>
			)}

			<section className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
				<div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
					<h2 className="text-sm font-semibold text-white light:text-slate-900">备份记录</h2>
					<span className="text-xs text-slate-500">{backups.length} 条</span>
				</div>
				<div className="divide-y divide-white/[0.06]">
					{backups.length === 0 ? <EmptyState text="暂无备份记录" /> : backups.map((b) => (
						<div key={b.id} className="px-5 py-4">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="text-sm font-medium text-white light:text-slate-900">{b.type} · {b.status}</h3>
									<p className="mt-1 text-xs text-slate-500">{b.filePath} · {formatZhDateTime(b.createdAt)}</p>
								</div>
								<span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400 light:text-slate-600">{b.creator?.displayName || b.creator?.username || "system"}</span>
							</div>
							<div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
								<span>大小：{formatBackupSize(b.fileSize)}</span>
								<span>完成：{b.completedAt ? formatZhDateTime(b.completedAt) : "未完成"}</span>
								{b.errorMessage && <span className="text-rose-300">错误：{b.errorMessage}</span>}
							</div>
							{b.note && <p className="mt-2 text-xs text-slate-400 light:text-slate-600">{b.note}</p>}
							{canRestore && (
								<div className="mt-3 grid gap-2">
									<code className="block overflow-auto rounded-lg border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-xs text-slate-300 light:border-slate-200 light:bg-slate-50 light:text-slate-800">{buildPortableBackupCommand({ projectRoot, outputPath: b.filePath, type: isBackupType(b.type) ? b.type : undefined })}</code>
									<code className="block overflow-auto rounded-lg border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-xs text-slate-300 light:border-slate-200 light:bg-slate-50 light:text-slate-800">{buildBackupRestoreCommand({ projectRoot, backupPath: b.filePath, type: isBackupType(b.type) ? b.type : undefined })}</code>
									<RestoreBackupButton backupId={b.id} backupType={b.type} disabled={b.status !== "COMPLETED"} />
									{b.status !== "COMPLETED" && <p className="text-xs text-slate-500">只有 COMPLETED 状态的备份可以执行恢复。</p>}
								</div>
							)}
							{canCreate && b.status !== "COMPLETED" && (
								<div className="mt-3 flex flex-wrap items-start gap-3">
									{b.status === "FAILED" && <RetryBackupRecordButton backupId={b.id} status={b.status} />}
									<VoidBackupRecordButton backupId={b.id} status={b.status} />
									<p className="mt-1 text-xs text-slate-500">对历史 PENDING/FAILED 记录写入作废说明，不删除备份审计记录。</p>
								</div>
							)}
						</div>
					))}
				</div>
			</section>
		</PageShell>
	);
}
