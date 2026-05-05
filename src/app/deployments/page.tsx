import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listDeploymentRuns } from "@/lib/deployment/service";

export const dynamic = "force-dynamic";

export default async function DeploymentsPage() {
  const session = await requireSession("/deployments");
  if (!sessionHasPermission(session, "deploy:read")) return <Shell><EmptyState text="你没有应用部署查看权限。" /></Shell>;
  const runs = await listDeploymentRuns();
  return <Shell><header className="mb-8"><p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Deploy</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">应用部署模板</h1><p className="mt-1.5 text-sm text-slate-500">复用命令模板变量渲染和审批链路，形成可审计的应用/服务部署运行记录。</p></header><div className="rounded-xl border border-white/[0.06] bg-white/[0.02]"><div className="border-b border-white/[0.06] px-5 py-4 text-sm font-semibold text-white">部署运行</div><div className="divide-y divide-white/[0.06]">{runs.length===0?<EmptyState text="暂无部署运行记录"/>:runs.map((r)=><div key={r.id} className="px-5 py-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-medium text-white">{r.template.name}</h3><p className="mt-1 text-xs text-slate-500">目标 {r.serverIds.length} 台 · {r.createdAt.toLocaleString("zh-CN")}</p></div><span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400">{r.status}</span></div><code className="mt-3 block rounded-lg bg-black/30 p-3 text-xs text-slate-300 overflow-auto">{r.renderedCommand}</code></div>)}</div></div></Shell>;
}
function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100"><div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">{children}</div></main>; }
function EmptyState({ text }: { text: string }) { return <div className="p-8 text-center text-sm text-slate-500">{text}</div>; }
