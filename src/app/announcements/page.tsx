import { requireSession } from "@/lib/auth/require-session";
import { listActiveAnnouncements } from "@/lib/announcement/service";
export const dynamic="force-dynamic";
export default async function Page(){await requireSession("/announcements"); const items=await listActiveAnnouncements(); return <Shell><h1 className="text-3xl font-semibold text-white">站内公告</h1><p className="mt-2 text-sm text-slate-400">展示当前有效、置顶优先的站内消息。</p><div className="mt-6 grid gap-3">{items.map(a=><Card key={a.id}><div className="flex gap-2"><b>{a.title}</b>{a.pinned&&<span className="text-xs text-amber-300">置顶</span>}</div><p className="mt-2 text-sm text-slate-300 whitespace-pre-wrap">{a.body}</p></Card>)}{items.length===0&&<Card>暂无公告。</Card>}</div></Shell>}
function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100"><div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">{children}</div></main>; }
function Card({children}:{children:React.ReactNode}){return <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">{children}</div>}
