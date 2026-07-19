"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type Report = {
  range: { days: number; action: string };
  totals: { total: number; view: number; download: number; passwordAttempt: number; uniqueIps: number };
  byShare: Array<{ shareId: string; name: string; path: string; total: number; view: number; download: number; passwordAttempt: number }>;
  logs: Array<{ id: string; action: string; ip: string | null; userAgent: string | null; accessedAt: string; share: { name: string | null; path: string } }>;
};

export function ShareAccessReport() {
  const { t } = useI18n();
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; }, [t]);
  const [days, setDays] = useState("30");
  const [action, setAction] = useState("all");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextDays: string, nextAction: string) => {
    setLoading(true); setError(null);
    try {
      const data = await csrfFetch<{ report: Report }>(`/api/shares/access-report?days=${encodeURIComponent(nextDays)}&action=${encodeURIComponent(nextAction)}&limit=100`);
      setReport(data.report);
    } catch (cause) { setError(cause instanceof Error ? cause.message : tRef.current("sharesPage.report.error")); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load("30", "all"); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const exportHref = `/api/shares/access-report?days=${encodeURIComponent(days)}&action=${encodeURIComponent(action)}&limit=500&format=csv`;
  return <section data-card className="mb-6 overflow-hidden !p-0">
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
      <div><h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("sharesPage.report.title")}</h2><p className="mt-1 text-xs text-[var(--text-muted)]">{t("sharesPage.report.desc")}</p></div>
      <div className="flex flex-wrap gap-2">
        <select aria-label={t("sharesPage.report.range")} value={days} onChange={(e) => { setDays(e.target.value); void load(e.target.value, action); }} className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs">
          <option value="7">{t("sharesPage.report.days7")}</option><option value="30">{t("sharesPage.report.days30")}</option><option value="90">{t("sharesPage.report.days90")}</option>
        </select>
        <select aria-label={t("sharesPage.report.action")} value={action} onChange={(e) => { setAction(e.target.value); void load(days, e.target.value); }} className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-xs">
          <option value="all">{t("sharesPage.report.all")}</option><option value="view">{t("sharesPage.accessLogs.action.view")}</option><option value="download">{t("sharesPage.accessLogs.action.download")}</option><option value="password_attempt">{t("sharesPage.accessLogs.action.password_attempt")}</option>
        </select>
        <a href={exportHref} className="rounded-xl border border-[var(--accent-border)] px-3 py-2 text-xs font-medium text-[var(--accent)]">{t("sharesPage.report.export")}</a>
      </div>
    </div>
    {loading ? <p className="p-5 text-sm text-[var(--text-muted)]">{t("sharesPage.accessLogs.loading")}</p> : error ? <p role="alert" className="p-5 text-sm text-[var(--danger)]">{error}</p> : report ? <div className="p-5">
      <div className="grid gap-3 sm:grid-cols-5">
        {([ ["total", report.totals.total], ["view", report.totals.view], ["download", report.totals.download], ["passwordAttempt", report.totals.passwordAttempt], ["uniqueIps", report.totals.uniqueIps] ] as const).map(([key, value]) => <div key={key} className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-3"><p className="text-xs text-[var(--text-muted)]">{t(`sharesPage.report.${key}`)}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}
      </div>
      <div className="mt-5 overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-muted)]"><th className="pb-2">{t("sharesPage.report.share")}</th><th>{t("sharesPage.report.total")}</th><th>{t("sharesPage.report.view")}</th><th>{t("sharesPage.report.download")}</th><th>{t("sharesPage.report.passwordAttempt")}</th></tr></thead><tbody>{report.byShare.slice(0, 20).map((row) => <tr key={row.shareId} className="border-b border-[var(--border-subtle)]"><td className="py-2 pr-4"><span className="font-medium">{row.name}</span><span className="ml-2 text-xs text-[var(--text-muted)]">/{row.path}</span></td><td>{row.total}</td><td>{row.view}</td><td>{row.download}</td><td>{row.passwordAttempt}</td></tr>)}</tbody></table>{report.byShare.length === 0 && <p className="py-4 text-sm text-[var(--text-muted)]">{t("sharesPage.report.empty")}</p>}</div>
      {report.logs.length > 0 ? <div className="mt-6 overflow-x-auto"><h3 className="mb-2 text-sm font-semibold">{t("sharesPage.report.recent")}</h3><table className="w-full text-xs"><thead><tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]"><th className="pb-2">{t("sharesPage.accessLogs.time")}</th><th>{t("sharesPage.report.share")}</th><th>{t("sharesPage.accessLogs.action")}</th><th>{t("sharesPage.accessLogs.ip")}</th><th>{t("sharesPage.report.userAgent")}</th></tr></thead><tbody>{report.logs.slice(0, 50).map((log) => <tr key={log.id} className="border-b border-[var(--border-subtle)]"><td className="py-2 pr-3 whitespace-nowrap">{new Date(log.accessedAt).toLocaleString()}</td><td className="pr-3">{log.share.name || log.share.path}</td><td className="pr-3">{t(`sharesPage.accessLogs.action.${log.action}`)}</td><td className="pr-3">{log.ip || "-"}</td><td className="max-w-72 truncate" title={log.userAgent || ""}>{log.userAgent || "-"}</td></tr>)}</tbody></table></div> : null}
    </div> : null}
  </section>;
}
