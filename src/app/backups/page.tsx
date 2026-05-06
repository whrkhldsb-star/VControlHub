import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { buildRestoreCommand, listBackupRecords } from "@/lib/backup/service";

export const dynamic = "force-dynamic";

const projectRoot = process.env.APP_DIR || process.cwd();

export default async function BackupsPage() {
  const session = await requireSession("/backups");
  if (!sessionHasPermission(session, "backup:read")) return <Shell><EmptyState text="你没有备份管理查看权限。" /></Shell>;
  const canCreate = sessionHasPermission(session, "backup:create");
  const canRestore = sessionHasPermission(session, "backup:restore");
  const backups = await listBackupRecords();
  return (
    <Shell>
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Portable</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">备份与迁移</h1>
        <p className="mt-1.5 text-sm text-slate-500">记录数据库/文件/完整备份，配合 deploy/backup.sh 与 restore-db.sh 支持迁移到其他系统。恢复命令只展示，不会绕过审批直接执行。</p>
      </header>

      {canCreate && (
        <section className="mb-6 rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">
          <h2 className="text-sm font-semibold text-white">一键创建备份记录</h2>
          <p className="mt-1 text-xs text-slate-500">创建可审计记录后，可在服务器上运行生成的 deploy/backup.sh 命令完成导出。</p>
          <form action="/api/backups" method="post" className="mt-4 grid gap-3 md:grid-cols-[180px_1fr_auto]">
            <select name="type" defaultValue="DATABASE" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100">
              <option value="DATABASE">数据库备份</option>
              <option value="FILES">文件备份</option>
              <option value="FULL">完整备份</option>
            </select>
            <input name="note" maxLength={500} placeholder="备注：例如升级前备份" className="rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600" />
            <button className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950">创建记录</button>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4"><h2 className="text-sm font-semibold text-white">备份记录</h2><span className="text-xs text-slate-500">{backups.length} 条</span></div>
        <div className="divide-y divide-white/[0.06]">{backups.length===0?<EmptyState text="暂无备份记录"/>:backups.map((b)=><div key={b.id} className="px-5 py-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium text-white">{b.type} · {b.status}</h3><p className="mt-1 text-xs text-slate-500">{b.filePath} · {b.createdAt.toLocaleString("zh-CN")}</p></div><span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400">{b.creator?.displayName||b.creator?.username||"system"}</span></div><div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500"><span>大小：{b.fileSize ? `${Math.round(Number(b.fileSize)/1024/1024)} MB` : "待生成"}</span><span>完成：{b.completedAt ? b.completedAt.toLocaleString("zh-CN") : "未完成"}</span>{b.errorMessage&&<span className="text-rose-300">错误：{b.errorMessage}</span>}</div>{b.note&&<p className="mt-2 text-xs text-slate-400">{b.note}</p>}{canRestore&&<code className="mt-3 block overflow-auto rounded-lg bg-black/30 p-3 text-xs text-slate-300">{buildRestoreCommand({ projectRoot, backupPath: b.filePath })}</code>}</div>)}</div>
      </section>
    </Shell>
  );
}
function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100"><div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">{children}</div></main>; }
function EmptyState({ text }: { text: string }) { return <div className="p-8 text-center text-sm text-slate-500">{text}</div>; }
