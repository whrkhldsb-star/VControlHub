import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listShareLinks } from "@/lib/share-link/service";

export const dynamic = "force-dynamic";

export default async function SharesPage() {
  const session = await requireSession("/shares");
  if (!sessionHasPermission(session, "share:read")) return <Shell><EmptyState text="你没有分享链接查看权限。" /></Shell>;
  const shares = await listShareLinks();
  return <Shell><header className="mb-8"><p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Sharing</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">文件分享链接</h1><p className="mt-1.5 text-sm text-slate-500">为云盘文件生成可撤销、可过期的分享 token；数据库仅保存哈希。</p></header><div className="rounded-xl border border-white/[0.06] bg-white/[0.02]"><div className="border-b border-white/[0.06] px-5 py-4 text-sm font-semibold text-white">分享记录</div><div className="divide-y divide-white/[0.06]">{shares.length===0?<EmptyState text="暂无分享链接"/>:shares.map((s)=><div key={s.id} className="px-5 py-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium text-white">{s.name || s.path}</h3><p className="mt-1 text-xs text-slate-500">{s.storageNode.name} · {s.path} · 访问 {s.accessCount} 次</p></div><span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400">{s.revokedAt ? "已撤销" : s.expiresAt && s.expiresAt < new Date() ? "已过期" : "有效"}</span></div><p className="mt-2 text-xs text-slate-500">创建：{s.createdAt.toLocaleString("zh-CN")} · 到期：{s.expiresAt?.toLocaleString("zh-CN") ?? "永不过期"}</p></div>)}</div></div></Shell>;
}
function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100"><div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">{children}</div></main>; }
function EmptyState({ text }: { text: string }) { return <div className="p-8 text-center text-sm text-slate-500">{text}</div>; }
