"use client";

import { useCallback, useEffect, useState } from "react";
import { PageShell, PageHeader } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalFromStorage, getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";

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
 <div data-card className="">
      <h3 className="mb-3 text-xs font-medium text-slate-400">{title}</h3>
      {children}
    </div>
  );
}

/** Key-value row — extracted to module top to avoid re-creation on every render */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right font-mono text-xs text-white">{value}</span>
    </div>
  );
}

/** Format an ISO timestamp into a readable local datetime; fall back to raw on parse failure. */
function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, {
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
  const { t } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true); // default on — SSE is cheaper than polling
  const [sseConnected, setSseConnected] = useState(false);
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(() =>
    typeof window === "undefined" ? 30 : getRefreshIntervalFromStorage(window.localStorage, 30),
  );

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
    const onStorage = () => setRefreshIntervalSeconds(getRefreshIntervalFromStorage(globalThis.localStorage, 30));
    window.addEventListener("storage", onStorage);
    window.addEventListener("vps-preferences-updated", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("vps-preferences-updated", onStorage);
    };
  }, []);

  // Initial fetch — need at least one HTTP snapshot for the loading state.
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
    let disposed = false;

    function closeSse() {
      if (es) { es.close(); es = null; }
      setSseConnected(false);
    }

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
        if (!disposed) {
          fallbackTimer = setInterval(() => { void fetchStats(); }, refreshIntervalSeconds * 1000);
        }
      };
      es.onopen = () => { setSseConnected(true); };
    } catch {
      // EventSource constructor failed (very old browser?) → fallback to polling.
      fallbackTimer = setInterval(() => { void fetchStats(); }, refreshIntervalSeconds * 1000);
    }

    return () => {
      disposed = true;
      closeSse();
      if (fallbackTimer) clearInterval(fallbackTimer);
    };
  }, [autoRefresh, fetchStats, refreshIntervalSeconds]);

  if (loading) {
    return (
      <PageShell>
        <div className="text-sm text-slate-500">{t("monitoringPage.loading")}</div>
      </PageShell>
    );
  }

  if (!stats) {
    return (
      <PageShell>
        <div data-tone="rose" className="rounded-2xl border border-rose-500/20 p-5 text-sm text-rose-100">
          <h1 className="mb-2 text-xl font-semibold text-rose-50">{t("monitoringPage.errorTitle")}</h1>
          <p className="text-rose-100/80/80">{errorMessage ?? t("monitoringPage.errorUnavailable")}</p>
          <button
            type="button"
            onClick={fetchStats}
            disabled={refreshing}
            className="mt-4 rounded-lg bg-rose-500 px-4 py-2 text-xs font-semibold text-white transition hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-60"
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
        eyebrow="Monitoring"
        title={t("monitoringPage.title")}
        description={t("monitoringPage.desc")}
        className="mb-6"
      />

      {errorMessage ? (
        <div data-tone="amber" className="mb-4 rounded-xl border border-amber-500/20 px-4 py-3 text-xs text-amber-100">
          {t("monitoringPage.lastRefreshFailed").replace("{message}", errorMessage)}
        </div>
      ) : null}

      <div className="mb-6 flex items-center gap-3">
        <button
          type="button"
          onClick={fetchStats}
          disabled={refreshing}
          className="rounded-lg bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-400 transition hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {refreshing ? t("monitoringPage.refreshing") : t("monitoringPage.refresh")}
        </button>
        <button
          type="button"
          onClick={() => setAutoRefresh(!autoRefresh)}
          disabled={refreshIntervalSeconds <= 0}
          className={`rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ?"bg-emerald-500/10 text-emerald-400" :"bg-slate-700/50 light:bg-slate-200/50 text-slate-400"}`}
        >
          {autoRefreshLabel}
        </button>
        {sseConnected && autoRefresh && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
            SSE
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
            <div className="mb-1 flex justify-between text-[10px] text-slate-500">
              <span>{t("monitoringPage.field.usage")}</span>
              <span>{stats.memory.usagePercent}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div
                className="h-full rounded-full bg-cyan-500 transition-[width]"
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
              <div className="font-mono text-xs text-white">{n.iface}</div>
              <div className="text-[10px] text-slate-500">↓ {n.rx} ↑ {n.tx}</div>
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
              <tr className="border-b border-white/[0.06] text-slate-500">
                <th className="py-2 text-left">PID</th>
                <th className="py-2 text-right">CPU%</th>
                <th className="py-2 text-right">MEM%</th>
                <th className="py-2 pl-4 text-left">{t("monitoringPage.table.command")}</th>
              </tr>
            </thead>
            <tbody>
              {stats.topProcesses.map((p) => (
                <tr key={p.pid} className="border-b border-white/[0.03]">
                  <td className="py-1.5 font-mono text-slate-400">{p.pid}</td>
                  <td className="py-1.5 text-right text-amber-400">{p.cpu}</td>
                  <td className="py-1.5 text-right text-cyan-400">{p.mem}</td>
                  <td className="max-w-[200px] truncate py-1.5 pl-4 text-white">{p.cmd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-4 text-[10px] text-slate-600">
        {t("monitoringPage.lastUpdated").replace("{timestamp}", formatTimestamp(stats.timestamp))}
      </p>
    </PageShell>
  );
}
