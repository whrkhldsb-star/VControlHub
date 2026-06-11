import { getPublicStatus } from "@/lib/status/service";

export const dynamic = "force-dynamic";

export default async function Page() {
  const status = await getPublicStatus();

  return (
    <main className="min-h-screen bg-slate-950 light:bg-white text-slate-100">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold">服务状态</h1>
        <p className="mt-2 text-sm text-slate-400 light:text-slate-600">
          公开安全摘要，不展示主机名、端口、连接串或内部凭据。
        </p>

        <div className="mt-6 rounded-xl border border-white/[0.08] bg-white/[0.03] p-5">
          <div className="flex items-center gap-3">
            <span className={`inline-block h-3 w-3 rounded-full ${
              status.summary.overall === "healthy" ? "bg-emerald-400" :
              status.summary.overall === "warning" ? "bg-amber-400" :
              "bg-rose-400"
            }`} />
            <span className="text-lg font-medium">总体：{status.summary.overall === "healthy" ? "正常" : status.summary.overall === "warning" ? "警告" : "异常"}</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            更新时间：{new Date(status.generatedAt).toLocaleString("zh-CN")}
          </p>
        </div>

        <div className="mt-4 grid gap-3">
          {status.checks.map((c) => (
            <div key={c.id} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${
                    c.status === "healthy" ? "bg-emerald-400" :
                    c.status === "warning" ? "bg-amber-400" :
                    "bg-rose-400"
                  }`} /> <b className="text-sm text-white">{c.label}</b> </div> <span className={`text-xs ${
                  c.status === "healthy" ? "text-emerald-400" :
                  c.status === "warning" ? "text-amber-400" :
                  "text-rose-400"
                }`}>
                  {c.status === "healthy" ? "正常" : c.status === "warning" ? "警告" : "异常"}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-slate-400 light:text-slate-600">{c.message}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-slate-600">
          VControlHub · {new Date().getFullYear()}
        </p>
      </div>
    </main>
  );
}
