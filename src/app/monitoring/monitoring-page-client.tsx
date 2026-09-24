"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageShell, PageHeader, SurfacePanel, Toolbar } from "@/components/page-shell";
import { z } from "zod";
import { RefreshCw } from "@/components/icons";
import { ActionButton } from "@/components/action-button";
import { InlineLoading, Notice, ProgressBar } from "@/components/ui-primitives";
import { StatusBadge } from "@/components/status-badge";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useRefreshInterval } from "@/lib/preferences/use-refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";

const statsSchema = z.object({
  hostname: z.string(), platform: z.string(), arch: z.string(), uptime: z.string(),
  cpu: z.object({ model: z.string(), cores: z.number(), usage: z.string(), loadAvg: z.array(z.string()) }),
  memory: z.object({ total: z.string(), used: z.string(), free: z.string(), usagePercent: z.string() }),
  disk: z.string(), network: z.array(z.object({ iface: z.string(), rx: z.string(), tx: z.string() })),
  topProcesses: z.array(z.object({ pid: z.string(), cpu: z.string(), mem: z.string(), cmd: z.string() })),
  tcpConnections: z.string(), timestamp: z.string(),
});
type Stats = z.infer<typeof statsSchema>;

/** Card wrapper — extracted to module top to avoid re-creation on every render */
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SurfacePanel title={title} className="h-full">
      {children}
    </SurfacePanel>
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

export default function MonitoringPage() {
  const { t, locale } = useI18n();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true); // default on — SSE is cheaper than polling
  const [sseConnected, setSseConnected] = useState(false);
  const [fallbackPolling, setFallbackPolling] = useState(false);
  const statsRequestRef = useRef<AbortController | null>(null);
  const streamRevisionRef = useRef(0);
  const refreshIntervalSeconds = useRefreshInterval(30);
  const autoRefreshActive = autoRefresh && refreshIntervalSeconds > 0;

  const getMonitoringErrorMessage = useCallback((error: unknown): string => {
    if (error instanceof Error && error.message.trim()) return error.message;
    if (typeof error === "string" && error.trim()) return error;
    return t("monitoringPage.errorUnavailable");
  }, [t]);

  const fetchStats = useCallback(async () => {
    statsRequestRef.current?.abort();
    const controller = new AbortController();
    statsRequestRef.current = controller;
    const streamRevision = streamRevisionRef.current;
    setRefreshing(true);
    const timeout = window.setTimeout(() => {
      if (statsRequestRef.current !== controller) return;
      statsRequestRef.current = null;
      controller.abort();
      if (streamRevisionRef.current === streamRevision) setErrorMessage(t("monitoringPage.errorUnavailable"));
      setLoading(false);
      setRefreshing(false);
    }, 20_000);
    controller.signal.addEventListener("abort", () => window.clearTimeout(timeout), { once: true });
    try {
      const data = await csrfFetch("/api/monitoring/stats", {
        signal: controller.signal,
      }) as Stats & { error?: string; message?: string };
      if (controller.signal.aborted || statsRequestRef.current !== controller || streamRevisionRef.current !== streamRevision) return;
      if (data.error) {
        setErrorMessage(data.error || data.message || t("monitoringPage.errorReturned"));
        return;
      }
      const parsed = statsSchema.safeParse(data);
      if (!parsed.success) throw new Error(t("monitoringPage.errorReturned"));
      setStats(parsed.data);
      setErrorMessage(null);
    } catch (error) {
      if (controller.signal.aborted || statsRequestRef.current !== controller || streamRevisionRef.current !== streamRevision) return;
      setErrorMessage(getMonitoringErrorMessage(error));
    } finally {
      window.clearTimeout(timeout);
      if (statsRequestRef.current === controller) {
        statsRequestRef.current = null;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [getMonitoringErrorMessage, t]);

  useEffect(() => () => {
    statsRequestRef.current?.abort();
    statsRequestRef.current = null;
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void fetchStats(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchStats]);

  useVisibilityInterval(
    () => { void fetchStats(); },
    autoRefreshActive && fallbackPolling
      ? refreshIntervalSeconds * 1000
      : null,
  );

  // Prefer real-time SSE; the shared visibility interval handles degraded polling.
  useEffect(() => {
    if (!autoRefreshActive) return;

    let es: EventSource | null = null;
    let disposed = false;
    let streamTimeout: ReturnType<typeof setTimeout> | undefined;

    function enableFallback() {
      if (disposed) return;
      clearTimeout(streamTimeout);
      setSseConnected(false);
      setFallbackPolling(true);
    }

    function armStreamTimeout() {
      clearTimeout(streamTimeout);
      // The server emits every five seconds. A silent connection should not
      // leave the dashboard frozen while claiming that live updates work.
      streamTimeout = setTimeout(enableFallback, 15_000);
    }

    function connect() {
      if (disposed || document.visibilityState === "hidden" || es) return;
      try {
        const source = new EventSource("/api/monitoring/stream");
        es = source;
        armStreamTimeout();
        source.addEventListener("stats", (e) => {
          if (disposed || es !== source || document.visibilityState === "hidden") return;
          try {
            const data = statsSchema.parse(JSON.parse(e.data));
            armStreamTimeout();
            streamRevisionRef.current++;
            setStats(data);
            setErrorMessage(null);
            setLoading(false);
            setSseConnected(true);
            setFallbackPolling(false);
          } catch {
            enableFallback();
            setErrorMessage(t("monitoringPage.errorReturned"));
          }
        });
        source.onerror = () => { if (es === source) enableFallback(); };
        // A connection alone does not prove that usable metrics arrived.
      } catch {
        enableFallback();
      }
    }
    function handleVisibility() {
      if (document.visibilityState === "hidden") {
        es?.close();
        es = null;
        clearTimeout(streamTimeout);
        setSseConnected(false);
      } else connect();
    }
    connect();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      disposed = true;
      clearTimeout(streamTimeout);
      es?.close();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [autoRefreshActive, t]);

  const toggleAutoRefresh = () => {
    if (autoRefresh) {
      setSseConnected(false);
      setFallbackPolling(false);
    }
    setAutoRefresh((enabled) => !enabled);
  };

  if (loading) {
    return (
      <PageShell>
        <InlineLoading label={t("monitoringPage.loading")} />
      </PageShell>
    );
  }

  if (!stats) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-[var(--danger-border)] bg-[var(--danger-bg)] p-5 text-sm text-[var(--danger)]">
          <h1 className="mb-2 text-xl font-semibold text-[var(--danger)]">{t("monitoringPage.errorTitle")}</h1>
          <p className="text-[var(--danger)]/80">{errorMessage ?? t("monitoringPage.errorUnavailable")}</p>
          <ActionButton
            type="button"
            onClick={fetchStats}
            disabled={refreshing}
            variant="danger-solid"
            className="mt-4 !text-sm"
          >
            {refreshing ? t("monitoringPage.retrying") : t("monitoringPage.retry")}
          </ActionButton>
        </div>
      </PageShell>
    );
  }

  const intervalLabel = getRefreshIntervalLabel(refreshIntervalSeconds);
  const autoRefreshLabel = autoRefreshActive
    ? t("monitoringPage.autoRefreshActive", { interval: intervalLabel })
    : refreshIntervalSeconds <= 0
      ? t("monitoringPage.autoRefreshOff")
      : t("monitoringPage.autoRefreshIdle", { interval: intervalLabel });

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("monitoringPage.eyebrow")}
        title={t("monitoringPage.title")}
        description={t("monitoringPage.desc")}
        className="mb-6"
      />

      {errorMessage ? (
        <Notice tone="warning">{t("monitoringPage.lastRefreshFailed", { message: errorMessage })}</Notice>
      ) : null}

      <Toolbar>
        <ActionButton variant="secondary"
          type="button"
          onClick={fetchStats}
          disabled={refreshing}
        >
          <RefreshCw size={16} aria-hidden className={refreshing ? "animate-spin" : undefined} />
          {refreshing ? t("monitoringPage.refreshing") : t("monitoringPage.refresh")}
        </ActionButton>
        <ActionButton variant="secondary"
          type="button"
          onClick={toggleAutoRefresh}
          disabled={refreshIntervalSeconds <= 0}
          aria-pressed={autoRefreshActive}
        >
          {autoRefreshLabel}
        </ActionButton>
        {sseConnected && autoRefreshActive && (
          <StatusBadge tone="success" size="sm" className="gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--success)] animate-pulse" />
            {t("monitoringPage.sseLabel")}
          </StatusBadge>
        )}
      </Toolbar>

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
          <Row label={t("monitoringPage.field.load")} value={stats.cpu.loadAvg.join(" / ")} />
        </Card>

        <Card title={t("monitoringPage.card.memory")}>
          <Row label={t("monitoringPage.field.total")} value={stats.memory.total} />
          <Row label={t("monitoringPage.field.used")} value={stats.memory.used} />
          <Row label={t("monitoringPage.field.free")} value={stats.memory.free} />
          <div className="mt-2">
            <div className="mb-1 flex justify-between text-xs text-[var(--text-muted)]">
              <span>{t("monitoringPage.field.usage")}</span>
              <span>{stats.memory.usagePercent}%</span>
            </div>
            <ProgressBar label={t("monitoringPage.card.memory")} value={Number(stats.memory.usagePercent)} height="sm" />
          </div>
        </Card>

        <Card title={t("monitoringPage.card.disk")}>
          <Row label={t("monitoringPage.field.diskUsage")} value={stats.disk} />
        </Card>

        <Card title={t("monitoringPage.card.network")}>
          {stats.network.length > 0 ? stats.network.map((n) => (
            <div key={n.iface} className="py-1.5">
              <div className="font-mono text-xs text-[var(--text-primary)]">{n.iface}</div>
              <div className="text-xs text-[var(--text-muted)]">↓ {t("monitoringPage.field.rx")} {n.rx} ↑ {t("monitoringPage.field.tx")} {n.tx}</div>
            </div>
          )) : <Row label={t("monitoringPage.field.noData")} value="-" />}
        </Card>

        <Card title={t("monitoringPage.card.tcp")}>
          <Row label={t("monitoringPage.field.activeConnections")} value={stats.tcpConnections} />
        </Card>
      </div>

      <div className="mt-4">
      <Card title={t("monitoringPage.card.topProcesses")}>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label={t("monitoringPage.card.topProcesses")}>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-elevated)] text-[var(--text-muted)]">
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
      </div>

      <p className="mt-4 text-xs text-[var(--text-muted)]">
        {t("monitoringPage.lastUpdated", { timestamp: formatTimestamp(stats.timestamp, locale) })}
      </p>
    </PageShell>
  );
}
