import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { buildBackupRestoreCommand, buildPortableBackupCommand, formatBackupSize, isBackupType, listBackupRecords, summarizeBackupPolicy } from "@/lib/backup/service";
import { PageShell, EmptyState } from "@/components/page-shell";
import { CreateBackupForm } from "./create-backup-form";
import { RestoreBackupButton } from "./restore-backup-button";

export const dynamic = "force-dynamic";

const projectRoot = process.env.APP_DIR || process.cwd();

export default async function BackupsPage() {
	const session = await requireSession("/backups");
	if (!sessionHasPermission(session, "backup:read")) return <PageShell><EmptyState text="你没有备份管理查看权限。" /></PageShell>;
	const canCreate = sessionHasPermission(session, "backup:create");
	const canRestore = sessionHasPermission(session, "backup:restore");
	const backups = await listBackupRecords();
	const summary = summarizeBackupPolicy(backups);
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
					<p className="text-xs text-slate-500">最近完成：{summary.latestCompletedAt ? summary.latestCompletedAt.toLocaleString("zh-CN") : "暂无"}</p>
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

			{canCreate && (
				<section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h2 className="text-sm font-semibold text-white light:text-slate-900">创建并执行备份</h2>
					<p className="mt-1 text-xs text-slate-500">提交后会立即在服务器执行对应的 deploy/backup.sh 模式，记录会从 RUNNING 更新为 COMPLETED 或 FAILED。</p>
					<CreateBackupForm />
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
									<p className="mt-1 text-xs text-slate-500">{b.filePath} · {b.createdAt.toLocaleString("zh-CN")}</p>
								</div>
								<span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400 light:text-slate-600">{b.creator?.displayName || b.creator?.username || "system"}</span>
							</div>
							<div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
								<span>大小：{formatBackupSize(b.fileSize)}</span>
								<span>完成：{b.completedAt ? b.completedAt.toLocaleString("zh-CN") : "未完成"}</span>
								{b.errorMessage && <span className="text-rose-300">错误：{b.errorMessage}</span>}
							</div>
							{b.note && <p className="mt-2 text-xs text-slate-400 light:text-slate-600">{b.note}</p>}
							{canRestore && (
								<div className="mt-3 grid gap-2">
									<code className="block overflow-auto rounded-lg bg-black/30 light:bg-slate-900/30 p-3 text-xs text-slate-300 light:text-slate-700">{buildPortableBackupCommand({ projectRoot, outputPath: b.filePath, type: isBackupType(b.type) ? b.type : undefined })}</code>
									<code className="block overflow-auto rounded-lg bg-black/30 light:bg-slate-900/30 p-3 text-xs text-slate-300 light:text-slate-700">{buildBackupRestoreCommand({ projectRoot, backupPath: b.filePath, type: isBackupType(b.type) ? b.type : undefined })}</code>
									<RestoreBackupButton backupId={b.id} backupType={b.type} disabled={b.status !== "COMPLETED"} />
									{b.status !== "COMPLETED" && <p className="text-xs text-slate-500">只有 COMPLETED 状态的备份可以执行恢复。</p>}
								</div>
							)}
						</div>
					))}
				</div>
			</section>
		</PageShell>
	);
}
