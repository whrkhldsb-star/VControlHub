"use client";

import { useCallback, useEffect, useState } from "react";
import { PageShell, PageHeader } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useRefreshInterval } from "@/lib/preferences/use-refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";

interface Stats {
  hostname: string;
  platform: string;
  arch: string;
  uptime: string;
  cpu: { model: string; cores: number; usage: string; loadAvg: string[] };
  memory: { total: string; used: string; free: string; usagePercent: string };
  disk: string;
  network: { iface: string; rx: string; tx: string }[];
  topProcesses: { pid: string; cpu: string; mem: string; cmd: string }[];
  tcpConnections: string;
  timestamp: string;
}

/** Card wrapper — extracted to module top to avoid re-creation on every render */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div data-card className="p-4">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{title}</h3>
      {children}
    </div>
  );
}

/** Key-value row — extracted to module top to avoid re-creation on every render */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-[var(--text-muted)]">{label}</span>
      <span className="min-w-0 break-words text-right font-mono text-xs text-[var(--text-primary)]">{value}</span>
    </div>
  );
}

/** Format an ISO timestamp into a readable local datetime; fall back to raw on parse failure. */
function formatTimestamp(value: string, locale?: "zh" | "en"): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(locale ? toDateLocale(locale) : undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function MonitoringPage({ canManage: _canManage }: { canManage: boolean }) {
  const { t, locale } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true); // default on — SSE is cheaper than polling
  const [sseConnected, setSseConnected] = useState(false);
  const refreshIntervalSeconds = useRefreshInterval(30);

  const getMonitoringErrorMessage = useCallback((error: unknown): string => {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return t("monitoringPage.errorUnavailable");
  }, [t]);

  const fetchStats = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await csrfFetch("/api/monitoring/stats") as Stats & { error?: string; message?: string };
      if (data.error) {
        setErrorMessage(data.error || data.message || t("monitoringPage.errorReturned"));
        return;
      }
      setStats(data);
      setErrorMessage(null);
    } catch (error) {
      setErrorMessage(getMonitoringErrorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [getMonitoringErrorMessage, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchStats(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchStats]);

  // SSE stream: replaces setInterval polling with real-time push.
  // Only active when autoRefresh=true. Falls back gracefully if
  // EventSource fails (network / auth / proxy) → re-enable HTTP
  // polling as a degraded mode.
  useEffect(() => {
    if (!autoRefresh) return;

    let es: EventSource | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;
    let fallbackEnabled = false;
    let disposed = false;

    function closeSse() {
      if (es) { es.close(); es = null; }
      setSseConnected(false);
    }

    function stopFallback() {
      if (fallbackTimer) clearInterval(fallbackTimer);
      fallbackTimer = null;
    }

    function startFallback() {
      fallbackEnabled = true;
      if (disposed || fallbackTimer || document.visibilityState === "hidden") return;
      fallbackTimer = setInterval(() => { void fetchStats(); }, refreshIntervalSeconds * 1000);
    }

    function onVisibilityChange() {
      if (!fallbackEnabled) return;
      if (document.visibilityState === "hidden") return stopFallback();
      void fetchStats();
      startFallback();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);

    try {
      es = new EventSource("/api/monitoring/stream");
      es.addEventListener("stats", (e) => {
        try {
          const data = JSON.parse(e.data) as Stats;
          setStats(data);
          setErrorMessage(null);
          setLoading(false);
          setSseConnected(true);
        } catch { /* malform → ignore, next tick will retry */ }
      });
      es.onerror = () => {
        closeSse();
        // Fallback: use HTTP polling at the user's configured interval.
        startFallback();
      };
      es.onopen = () => { setSseConnected(true); };
    } catch {
      // EventSource constructor failed (very old browser?) → fallback to polling.
      startFallback();
    }

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      closeSse();
      stopFallback();
    };
  }, [autoRefresh, fetchStats, refreshIntervalSeconds]);

  if (loading) {
    return (
      <PageShell>
        <div className="text-sm text-[var(--text-muted)]">{t("monitoringPage.loading")}</div>
      </PageShell>
    );
  }

  if (!stats) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-5 text-sm text-[var(--danger)]">
          <h1 className="mb-2 text-xl font-semibold text-[var(--danger)]">{t("monitoringPage.errorTitle")}</h1>
          <p className="text-[var(--danger)]/80">{errorMessage ?? t("monitoringPage.errorUnavailable")}</p>
          <button
            type="button"
            onClick={fetchStats}
            disabled={refreshing}
            className="mt-4 rounded-lg bg-[var(--danger)] px-4 py-2 text-xs font-semibold text-[var(--text-primary)] transition hover:bg-[var(--danger-bg)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? t("monitoringPage.retrying") : t("monitoringPage.retry")}
          </button>
        </div>
      </PageShell>
    );
  }

  const intervalLabel = getRefreshIntervalLabel(refreshIntervalSeconds);
  const autoRefreshLabel = autoRefresh
    ? t("monitoringPage.autoRefreshActive").replace("{interval}", intervalLabel)
    : refreshIntervalSeconds <= 0
      ? t("monitoringPage.autoRefreshOff")
      : t("monitoringPage.autoRefreshIdle").replace("{interval}", intervalLabel);

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("monitoringPage.eyebrow")}
        title={t("monitoringPage.title")}
        description={t("monitoringPage.desc")}
        className="mb-6"
      />

      {errorMessage ? (
        <div className="mb-4 rounded-xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-xs text-[var(--warning)]">
          {t("monitoringPage.lastRefreshFailed").replace("{message}", errorMessage)}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap items-center gap-3" data-toolbar>
        <button
          type="button"
          onClick={fetchStats}
          disabled={refreshing}
          className="rounded-xl bg-[var(--accent-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--accent)] transition hover:bg-[var(--accent-hover)] hover:text-[var(--on-accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? t("monitoringPage.refreshing") : t("monitoringPage.refresh")}
        </button>
        <button
          type="button"
          onClick={() => setAutoRefresh(!autoRefresh)}
          disabled={refreshIntervalSeconds <= 0}
          className={`rounded-xl px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ? "border border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]" : "border border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]"}`}
        >
          {autoRefreshLabel}
        </button>
        {sseConnected && autoRefresh && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[var(--success-bg)] px-2 py-0.5 text-[10px] text-[var(--success)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse" />
            {t("monitoringPage.sseLabel")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card title={t("monitoringPage.card.system")}>
          <Row label={t("monitoringPage.field.hostname")} value={stats.hostname} />
          <Row label={t("monitoringPage.field.platform")} value={`${stats.platform} ${stats.arch}`} />
          <Row label={t("monitoringPage.field.uptime")} value={stats.uptime} />
        </Card>

        <Card title={t("monitoringPage.card.cpu")}>
          <Row label={t("monitoringPage.field.model")} value={stats.cpu.model} />
          <Row label={t("monitoringPage.field.cores")} value={String(stats.cpu.cores)} />
          <Row label={t("monitoringPage.field.usage")} value={stats.cpu.usage} />
          <Row label={t("monitoringPage.field.load")} value={stats.cpu.loadAvg.join(" /")} />
        </Card>

        <Card title={t("monitoringPage.card.memory")}>
          <Row label={t("monitoringPage.field.total")} value={stats.memory.total} />
          <Row label={t("monitoringPage.field.used")} value={stats.memory.used} />
          <Row label={t("monitoringPage.field.free")} value={stats.memory.free} />
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-[10px] text-[var(--text-muted)]">
              <span>{t("monitoringPage.field.usage")}</span>
              <span>{stats.memory.usagePercent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-hover)]">
              <div
                className="h-full rounded-full bg-[var(--accent)] transition-[width]"
                style={{ width: `${stats.memory.usagePercent}%` }}
              />
            </div>
          </div>
        </Card>

        <Card title={t("monitoringPage.card.disk")}>
          <Row label={t("monitoringPage.field.diskUsage")} value={stats.disk} />
        </Card>

        <Card title={t("monitoringPage.card.network")}>
          {stats.network.length > 0 ? stats.network.map((n) => (
            <div key={n.iface} className="py-1.5">
              <div className="font-mono text-xs text-[var(--text-primary)]">{n.iface}</div>
              <div className="text-[10px] text-[var(--text-muted)]">↓ {t("monitoringPage.field.rx")} {n.rx} ↑ {t("monitoringPage.field.tx")} {n.tx}</div>
            </div>
          )) : <Row label={t("monitoringPage.field.noData")} value="-" />}
        </Card>

        <Card title={t("monitoringPage.card.tcp")}>
          <Row label={t("monitoringPage.field.activeConnections")} value={stats.tcpConnections} />
        </Card>
      </div>

      <Card title={t("monitoringPage.card.topProcesses")}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                <th className="py-2 text-left">{t("monitoringPage.table.pid")}</th>
                <th className="py-2 text-right">{t("monitoringPage.table.cpu")}</th>
                <th className="py-2 text-right">{t("monitoringPage.table.mem")}</th>
                <th className="py-2 pl-4 text-left">{t("monitoringPage.table.command")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.topProcesses.map((p) => (
                <tr key={p.pid} className="border-b border-[var(--border)]">
                  <td className="py-1.5 font-mono text-[var(--text-muted)]">{p.pid}</td>
                  <td className="py-1.5 text-right text-[var(--warning)]">{p.cpu}</td>
                  <td className="py-1.5 text-right text-[var(--accent)]">{p.mem}</td>
                  <td className="max-w-[200px] truncate py-1.5 pl-4 text-[var(--text-primary)]">{p.cmd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-4 text-[10px] text-[var(--text-muted)]">
        {t("monitoringPage.lastUpdated").replace("{timestamp}", formatTimestamp(stats.timestamp, locale))}
      </p>
    </PageShell>
  );
}
