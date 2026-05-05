import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listTickets } from "@/lib/ticket/service";
export const dynamic="force-dynamic";
export default async function Page(){const session=await requireSession("/tickets"); if(!sessionHasPermission(session,"ticket:manage")) return <Shell>缺少权限</Shell>; const tickets=await listTickets(session.userId); return <Shell><h1 className="text-3xl font-semibold text-white">工单与请求</h1><p className="mt-2 text-sm text-slate-400">用于提交资源申请、问题反馈和运维请求，支持状态流转与评论。</p><div className="mt-6 grid gap-3">{tickets.map(t=><Card key={t.id}><div className="flex justify-between"><b>{t.title}</b><span className="text-xs text-slate-400">{t.status} · {t.priority}</span></div><p className="mt-2 text-sm text-slate-300">{t.description}</p></Card>)}{tickets.length===0&&<Card>暂无工单。</Card>}</div></Shell>}
function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100"><div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">{children}</div></main>; }
function Card({children}:{children:React.ReactNode}){return <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">{children}</div>}
