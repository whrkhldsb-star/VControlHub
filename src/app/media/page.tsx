import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listMediaItems } from "@/lib/media/service";
export const dynamic="force-dynamic";
export default async function Page(){const session=await requireSession("/media"); if(!sessionHasPermission(session,"storage:read")) return <Shell>缺少权限</Shell>; const media=await listMediaItems(); return <Shell><h1 className="text-3xl font-semibold text-white">媒体库</h1><p className="mt-2 text-sm text-slate-400">聚合云盘中的图片和视频元数据，支持收藏、标签和媒体类型过滤。</p><div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{media.map(m=><Card key={m.id}><div className="text-sm font-medium">{m.name}</div><p className="mt-1 text-xs text-slate-500">{m.mediaType} · {m.relativePath}</p></Card>)}{media.length===0&&<Card>暂无媒体条目，可调用扫描接口从文件索引生成。</Card>}</div></Shell>}
function Shell({ children }: { children: React.ReactNode }) { return <main className="min-h-screen bg-[radial-gradient(circle_at_top,#1e293b,transparent_40%),linear-gradient(180deg,#0f172a_0%,#020617_100%)] text-slate-100"><div className="mx-auto max-w-6xl px-6 py-10 lg:px-10">{children}</div></main>; }
function Card({children}:{children:React.ReactNode}){return <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-5">{children}</div>}
