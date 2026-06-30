import { getPublicStatus } from "@/lib/status/service";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const revalidate = 60;

export default async function Page() {
  const status = await getPublicStatus();
  const locale = await getServerLocale();

  return (
    <main className="min-h-screen bg-slate-950 text-[var(--text-primary)]">
      <div className="mx-auto max-w-3xl px-6 py-14">
        <h1 className="text-3xl font-semibold">{t("statusPage.title", locale)}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {t("statusPage.desc", locale)}
        </p>

 <div data-card className="mt-6 ">
          <div className="flex items-center gap-3">
            <span className={`inline-block h-3 w-3 rounded-full ${
              status.summary.overall === "healthy" ? "bg-emerald-400" :
              status.summary.overall === "warning" ? "bg-amber-400" :
              "bg-rose-400"
            }`} />
            <span className="text-lg font-medium">{t("statusPage.overallLabel", locale)}{status.summary.overall === "healthy" ? "正常" : status.summary.overall === "warning" ? "警告" : "异常"}</span>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {t("statusPage.updatedAt", locale)}{new Date(status.generatedAt).toLocaleString("zh-CN")}
          </p>
        </div>

        <div className="mt-4 grid gap-3">
          {status.checks.map((c) => (
            <div key={c.id} data-card className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${
                    c.status === "healthy" ? "bg-emerald-400" :
                    c.status === "warning" ? "bg-amber-400" :
                    "bg-rose-400"
                  }`} /> <b className="text-sm text-[var(--text-primary)]">{c.label}</b> </div> <span className={`text-xs ${
                  c.status === "healthy" ? "text-emerald-400" :
                  c.status === "warning" ? "text-amber-400" :
                  "text-rose-400"
                }`}>
                  {c.status === "healthy" ? "正常" : c.status === "warning" ? "警告" : "异常"}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-[var(--text-secondary)]">{c.message}</p>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-[var(--text-muted)]">
          VControlHub · {new Date().getFullYear()}
        </p>
      </div>
    </main>
  );
}
