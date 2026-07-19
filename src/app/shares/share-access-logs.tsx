"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { csrfFetch } from "@/lib/auth/csrf-client";

interface AccessLog {
  id: string;
  action: string;
  ip: string | null;
  userAgent: string | null;
  accessedAt: string;
}

export function ShareAccessLogsButton({ shareId }: { shareId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setLoading(true);
    setError(null);
    try {
      const data = await csrfFetch<{ logs: AccessLog[] }>(`/api/shares/${encodeURIComponent(shareId)}/access-logs`);
      setLogs(data.logs);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("sharesPage.accessLogs.error"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        data-action-button data-variant="secondary" className="!px-2.5 !py-1 !text-xs"
      >
        {t("sharesPage.accessLogs.view")}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] p-3">
          {loading ? (
            <p className="text-xs text-[var(--text-muted)]">{t("sharesPage.accessLogs.loading")}</p>
          ) : error ? (
            <p className="text-xs text-[var(--danger)]">{error}</p>
          ) : logs.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">{t("sharesPage.accessLogs.empty")}</p>
          ) : (
            <div className="max-h-60 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--border)] text-left text-[var(--text-muted)]">
                    <th className="pb-1 pr-3 font-medium">{t("sharesPage.accessLogs.action")}</th>
                    <th className="pb-1 pr-3 font-medium">{t("sharesPage.accessLogs.ip")}</th>
                    <th className="pb-1 pr-3 font-medium">{t("sharesPage.accessLogs.time")}</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-[var(--border-subtle)] last:border-0">
                      <td className="py-1.5 pr-3">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                          log.action === "download" ? "bg-[var(--accent-bg)] text-[var(--accent)]"
                          : log.action === "view" ? "bg-[var(--surface-hover)] text-[var(--text-secondary)]"
                          : "bg-[var(--warning-bg)] text-[var(--warning)]"
                        }`}>
                          {t(`sharesPage.accessLogs.action.${log.action}`) !== `sharesPage.accessLogs.action.${log.action}` ? t(`sharesPage.accessLogs.action.${log.action}`) : log.action}
                        </span>
                      </td>
                      <td className="py-1.5 pr-3 text-[var(--text-muted)]">{log.ip || "-"}</td>
                      <td className="py-1.5 pr-3 text-[var(--text-muted)]">{new Date(log.accessedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
