import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listBackupRecords } from "@/lib/backup/service";

export const dynamic = "force-dynamic";

export default async function BackupsPage() {
  const session = await requireSession("/backups");
  if (!sessionHasPermission(session, "backup:read")) return <Shell><EmptyState text="你没有备份管理查看权限。" /></Shell>;
  const canCreate = sessionHasPermission(session, "backup:create");
  const backups = await listBackupRecords();
  return <Shell><header className="mb-8"><p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Portable</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">备份与迁移</h1><p className="mt-1.5 text-sm text-slate-500">记录数据库/文件/完整备份，配合 deploy/backup.sh 与 restore-db.sh 支持迁移到其他系统。</p></header><div className="rounded-xl border border-white/[0.06] bg-white/[0.02]"><div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4"><h2 className="text-sm font-semibold text-white">备份记录</h2>{canCreate && <form action="/api/backups" method="post"><span className="text-xs text-slate-500">可通过 API 创建备份记录</span></form>}</div><div className="divide-y divide-white/[0.06]">{backups.length===0?<EmptyState text="暂无备份记录"/>:backups.map((b)=><div key={b.id} className="px-5 py-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium text-white">{b.type} · {b.status}</h3><p className="mt-1 text-xs text-slate-500">{b.filePath} · {b.createdAt.toLocaleString("zh-CN")}</p></div><span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400">{b.creator?.displayName||b.creator?.username||"system"}</span></div>{b.note&&<p className="mt-2 text-xs text-slate-400">{b.note}</p>}</div>)}</div></div></Shell>;
}
function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100"><div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">{children}</div></main>; }
function EmptyState({ text }: { text: string }) { return <div className="p-8 text-center text-sm text-slate-500">{text}</div>; }
