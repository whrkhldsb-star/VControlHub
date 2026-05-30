import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { buildBackupRestoreCommand, buildPortableBackupCommand, isBackupType, listBackupRecords } from "@/lib/backup/service";
import { PageShell, EmptyState } from "@/components/page-shell";
import { CreateBackupForm } from "./create-backup-form";

export const dynamic = "force-dynamic";

const projectRoot = process.env.APP_DIR || process.cwd();

export default async function BackupsPage() {
	const session = await requireSession("/backups");
	if (!sessionHasPermission(session, "backup:read")) return <PageShell><EmptyState text="你没有备份管理查看权限。" /></PageShell>;
	const canCreate = sessionHasPermission(session, "backup:create");
	const canRestore = sessionHasPermission(session, "backup:restore");
	const backups = await listBackupRecords();
	return (
		<PageShell>
			<header className="mb-8">
				<p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Portable</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">备份与迁移</h1>
				<p className="mt-1.5 text-sm text-slate-500">记录数据库/文件/完整备份，配合 deploy/backup.sh 与 restore-db.sh 支持迁移到其他系统。恢复命令只展示，不会绕过审批直接执行。</p>
			</header>

			{canCreate && (
				<section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
					<h2 className="text-sm font-semibold text-white">创建并执行备份</h2>
					<p className="mt-1 text-xs text-slate-500">提交后会立即在服务器执行对应的 deploy/backup.sh 模式，记录会从 RUNNING 更新为 COMPLETED 或 FAILED。</p>
					<CreateBackupForm />
			</section>
			)}

			<section className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
				<div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
					<h2 className="text-sm font-semibold text-white">备份记录</h2>
					<span className="text-xs text-slate-500">{backups.length} 条</span>
				</div>
				<div className="divide-y divide-white/[0.06]">
					{backups.length === 0 ? <EmptyState text="暂无备份记录" /> : backups.map((b) => (
						<div key={b.id} className="px-5 py-4">
							<div className="flex items-center justify-between gap-3">
								<div>
									<h3 className="text-sm font-medium text-white">{b.type} · {b.status}</h3>
									<p className="mt-1 text-xs text-slate-500">{b.filePath} · {b.createdAt.toLocaleString("zh-CN")}</p>
								</div>
								<span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400">{b.creator?.displayName || b.creator?.username || "system"}</span>
							</div>
							<div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
								<span>大小：{b.fileSize ? `${Math.round(Number(b.fileSize)/1024/1024)} MB` : "待生成"}</span>
								<span>完成：{b.completedAt ? b.completedAt.toLocaleString("zh-CN") : "未完成"}</span>
								{b.errorMessage && <span className="text-rose-300">错误：{b.errorMessage}</span>}
							</div>
							{b.note && <p className="mt-2 text-xs text-slate-400">{b.note}</p>}
							{canRestore && (
								<div className="mt-3 grid gap-2">
									<code className="block overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">{buildPortableBackupCommand({ projectRoot, outputPath: b.filePath, type: isBackupType(b.type) ? b.type : undefined })}</code>
									<code className="block overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">{buildBackupRestoreCommand({ projectRoot, backupPath: b.filePath, type: isBackupType(b.type) ? b.type : undefined })}</code>
								</div>
							)}
						</div>
					))}
				</div>
			</section>
		</PageShell>
	);
}
