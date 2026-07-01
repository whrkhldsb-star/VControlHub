"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageShell, PageHeader } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useRefreshInterval } from "@/lib/preferences/use-refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";
import { TrafficSparkline, type TrafficSample } from "./traffic-sparkline";

const HISTORY_LIMIT = 60; // ≈ 30 min at 30s polling cadence

type InterfaceTraffic = {
  iface: string;
  rxBytes: number;
  txBytes: number;
  rxLabel: string;
  txLabel: string;
  rxRateBytesPerSecond: number;
  txRateBytesPerSecond: number;
  rxRateLabel: string;
  txRateLabel: string;
  intervalSeconds: number;
};

type RemoteServerTraffic = {
  serverId: string;
  serverName: string;
  host: string;
  primaryInterface: InterfaceTraffic | null;
  interfaces: InterfaceTraffic[];
  sampledAt: string;
  error: string | null;
};

type TrafficSummary = {
  timestamp: string;
  currentServer: {
    name: string;
    primaryInterface: InterfaceTraffic | null;
    interfaces: InterfaceTraffic[];
  };
  storageNodes: Array<{
    id: string;
    name: string;
    driver: string;
    serverId?: string | null;
    host?: string | null;
    port?: number | null;
    healthStatus: string;
    trafficSource: string;
    trafficSourceLabel: string;
    trafficSourceDetail: string;
    remoteServerId?: string | null;
    server?: { id: string; name: string; host: string; port: number } | null;
  }>;
  remoteServers?: RemoteServerTraffic[];
  servers: Array<{ id: string; name: string; host: string; port: number }>;
};

type TrafficHistoryPoint = TrafficSample & {
  source: string;
  serverId: string | null;
  iface: string;
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)]/[0.04] p-5">
      <h2 className="mb-4 text-sm font-medium text-[var(--text-secondary)]">{title}</h2>
      {children}
    </section>
  );
}

function RateBadge({ label, value, color }: { label: string; value: string; color: "cyan" | "emerald" }) {
  const styles = color === "cyan" ? "bg-cyan-500/10 text-cyan-300" : "bg-emerald-500/10 text-emerald-300";
  return (
    <div className={`rounded-xl px-4 py-3 ${styles}`}>
      <div className="text-[11px] opacity-70">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function formatStorageHealthStatus(t: (key: string) => string, status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "HEALTHY" || normalized === "ONLINE") return t("trafficPage.health.online");
  if (normalized === "WARNING") return t("trafficPage.health.attention");
  if (normalized === "CRITICAL" || normalized === "OFFLINE") return t("trafficPage.health.abnormal");
  if (normalized === "UNKNOWN" || normalized === "") return t("trafficPage.health.unsampled");
  return status;
}

function groupHistory(points: TrafficHistoryPoint[], scope: "24h" | "7d") {
  if (scope === "24h") {
    const byIface = new Map<string, TrafficHistoryPoint[]>();
    for (const point of points) {
      const list = byIface.get(point.iface) ?? [];
      list.push(point);
      byIface.set(point.iface, list);
    }
    return byIface;
  }
  const daily = new Map<string, TrafficHistoryPoint[]>();
  for (const point of points) {
    const d = new Date(point.t);
    // Group by LOCAL calendar date (not UTC) so day boundaries match the
    // viewer's timezone — otherwise points after 16:00 UTC land on the wrong day for UTC+8.
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = daily.get(day) ?? [];
    list.push(point);
    daily.set(day, list);
  }
  return daily;
}

export default function TrafficPage({ canManage: _canManage }: { canManage: boolean }) {
  const { t } = useI18n();
  const [summary, setSummary] = useState<TrafficSummary | null>(null);
  const [remoteServers, setRemoteServers] = useState<RemoteServerTraffic[] | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [selectedIface, setSelectedIface] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshIntervalSeconds = useRefreshInterval(30);
  const [history, setHistory] = useState<TrafficSample[]>([]);
  const [history7d, setHistory7d] = useState<TrafficHistoryPoint[]>([]);
  const [historyScope, setHistoryScope] = useState<"24h" | "7d">("24h");
  const lastIfaceRef = useRef<string>("");

  const fetchHistory = useCallback(async (scope: "24h" | "7d", iface = selectedIface) => {
    try {
      const params = new URLSearchParams();
      params.set("hours", scope === "24h" ? "24" : "168");
      if (iface) params.set("iface", iface);
      const data = (await csrfFetch(`/api/traffic/history?${params.toString()}`)) as { history?: TrafficHistoryPoint[]; error?: string };
      if (data.error || !Array.isArray(data.history)) return;
      if (scope === "24h") {
        setHistory(
          data.history.slice(-HISTORY_LIMIT).map((point) => ({ t: new Date(point.t).getTime(), rx: point.rx, tx: point.tx })),
        );
      } else {
        setHistory7d(data.history);
      }
    } catch {
      // best effort
    }
  }, [selectedIface]);

  const fetchSummary = useCallback(async (iface = selectedIface) => {
    try {
      const params = new URLSearchParams();
      if (iface) params.set("iface", iface);
      const data = (await csrfFetch(`/api/traffic/summary${params.toString() ? `?${params}` : ""}`)) as TrafficSummary & { error?: string };
      if (data.error) {
        setError(data.error);
        return;
      }
      setSummary(data);
      setError("");
      const prim = data.currentServer?.primaryInterface;
      if (prim) {
        const ifaceKey = prim.iface;
        if (lastIfaceRef.current !== ifaceKey) {
          lastIfaceRef.current = ifaceKey;
          setHistory([{ t: Date.now(), rx: prim.rxRateBytesPerSecond, tx: prim.txRateBytesPerSecond }]);
        } else {
          setHistory((prev) => {
            const next = [...prev, { t: Date.now(), rx: prim.rxRateBytesPerSecond, tx: prim.txRateBytesPerSecond }];
            return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
          });
        }
      }
    } catch {
      setError(t("trafficPage.error.fetch"));
    } finally {
      setLoading(false);
    }
  }, [selectedIface, t]);

  const fetchRemote = useCallback(async () => {
    setRemoteLoading(true);
    try {
      const data = (await csrfFetch(`/api/traffic/summary?include=remote`)) as TrafficSummary & { error?: string };
      if (data.error) return;
      setRemoteServers(data.remoteServers ?? []);
    } catch {
      // soft-fail
    } finally {
      setRemoteLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchSummary(); void fetchHistory(historyScope); }, 0);
    return () => clearTimeout(timer);
  }, [fetchHistory, fetchSummary, historyScope]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchRemote(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchRemote]);
  useEffect(() => {
    if (!autoRefresh || refreshIntervalSeconds <= 0) return;
    const id = setInterval(() => {
      void fetchSummary();
      void fetchRemote();
      void fetchHistory(historyScope);
    }, refreshIntervalSeconds * 1000);
    return () => clearInterval(id);
  }, [autoRefresh, fetchHistory, fetchRemote, fetchSummary, historyScope, refreshIntervalSeconds]);

  const primary = summary?.currentServer.primaryInterface ?? null;
  const refreshLabel = getRefreshIntervalLabel(refreshIntervalSeconds);
  const persistedTrend = useMemo(() => {
    if (historyScope === "24h") return null;
    return groupHistory(history7d, historyScope);
  }, [history7d, historyScope]);

  return (
    <PageShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageHeader eyebrow={t("trafficPage.eyebrow")} title={t("trafficPage.title")} description={t("trafficPage.desc")} />
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => fetchSummary()} className="rounded-lg bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20">{t("trafficPage.refresh")}</button>
          <button onClick={() => setAutoRefresh((v) => !v)} disabled={refreshIntervalSeconds <= 0} className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ? "bg-emerald-500/10 text-emerald-300" : "bg-slate-700/60 text-[var(--text-secondary)]"}`}>
            {autoRefresh
              ? t("trafficPage.autoRefreshOn").replace("{label}", refreshLabel)
              : refreshIntervalSeconds <= 0
                ? t("trafficPage.autoRefreshOff")
                : t("trafficPage.autoRefreshPaused").replace("{label}", refreshLabel)}
          </button>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => { setHistoryScope("24h"); void fetchHistory("24h"); }} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${historyScope === "24h" ? "bg-cyan-500/15 text-[var(--text-secondary)]" : "bg-[var(--surface)]/[0.04] text-[var(--text-secondary)]"}`}>24h</button>
        <button type="button" onClick={() => { setHistoryScope("7d"); void fetchHistory("7d"); }} className={`rounded-lg px-3 py-1.5 text-xs font-medium ${historyScope === "7d" ? "bg-cyan-500/15 text-[var(--text-secondary)]" : "bg-[var(--surface)]/[0.04] text-[var(--text-secondary)]"}`}>7d</button>
        <span className="text-xs text-[var(--text-muted)]">{historyScope === "24h" ? t("trafficPage.historyHint24h") : t("trafficPage.historyHint7d")}</span>
      </div>

      <div className="space-y-5">
        <Card title={t("trafficPage.card.realtime")}>
          {loading && !summary ? (
            <div className="text-sm text-[var(--text-muted)]">{t("trafficPage.loading")}</div>
          ) : summary ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="text-xs text-[var(--text-muted)]" htmlFor="trafficIface">{t("trafficPage.iface.label")}</label>
                <select id="trafficIface" value={selectedIface} onChange={(e) => setSelectedIface(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                  <option value="">{t("trafficPage.iface.auto")}</option>
                  {summary.currentServer.interfaces.map((item) => <option key={item.iface} value={item.iface}>{item.iface}</option>)}
                </select>
                <span className="text-[11px] text-[var(--text-muted)]">{t("trafficPage.lastUpdated").replace("{date}", new Date(summary.timestamp).toLocaleString("zh-CN"))}</span>
              </div>
              {primary ? (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <RateBadge label={t("trafficPage.rxRate").replace("{iface}", primary.iface)} value={primary.rxRateLabel} color="cyan" />
                    <RateBadge label={t("trafficPage.txRate").replace("{iface}", primary.iface)} value={primary.txRateLabel} color="emerald" />
                  </div>
                  <div className="mt-4">
                    {historyScope === "24h" ? (
                      <TrafficSparkline
                        samples={history}
                        labels={{
                          rx: t("trafficPage.rxShort"),
                          tx: t("trafficPage.txShort"),
                          empty: t("trafficPage.chart.empty"),
                          windowHint: t("trafficPage.chart.windowHint"),
                        }}
                      />
                    ) : (
                      <div className="rounded-xl border border-[var(--border)] bg-black/20 p-3">
                        {persistedTrend && persistedTrend.size > 0 ? (
                          <div className="space-y-4">
                            {Array.from(persistedTrend.entries()).map(([key, points]) => (
                              <div key={key}>
                                <div className="mb-2 text-xs text-[var(--text-muted)]">{key}</div>
                                <TrafficSparkline
                                  samples={points.map((point) => ({ t: new Date(point.t).getTime(), rx: point.rx, tx: point.tx }))}
                                  labels={{
                                    rx: t("trafficPage.rxShort"),
                                    tx: t("trafficPage.txShort"),
                                    empty: t("trafficPage.chart.empty"),
                                    windowHint: t("trafficPage.chart.windowHint"),
                                  }}
                                />
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-sm text-[var(--text-muted)]">{t("trafficPage.chart.emptyHistory")}</div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-[var(--text-secondary)] md:grid-cols-2">
                    <div className="rounded-xl bg-black/20 p-3 light:ring-1 light:ring-slate-200">{t("trafficPage.rxTotal").replace("{value}", primary.rxLabel)}<span className="font-mono text-[var(--text-primary)]"> </span></div>
                    <div className="rounded-xl bg-black/20 p-3 light:ring-1 light:ring-slate-200">{t("trafficPage.txTotal").replace("{value}", primary.txLabel)}<span className="font-mono text-[var(--text-primary)]"> </span></div>
                  </div>
                </>
              ) : <div className="text-sm text-[var(--text-muted)]">{t("trafficPage.noIface")}</div>}
            </>
          ) : null}
        </Card>

        <Card title={t("trafficPage.card.detail")}>
          {loading && !summary ? (
            <div className="text-sm text-[var(--text-muted)]">{t("trafficPage.loading")}</div>
          ) : summary ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-[var(--text-muted)]"><tr><th className="py-2 text-left">{t("trafficPage.th.iface")}</th><th className="text-right">{t("trafficPage.th.rxRate")}</th><th className="text-right">{t("trafficPage.th.txRate")}</th><th className="text-right">{t("trafficPage.th.rxTotal")}</th><th className="text-right">{t("trafficPage.th.txTotal")}</th></tr></thead>
                <tbody>
                  {summary.currentServer.interfaces.map((item) => <tr key={item.iface} className="border-t border-[var(--border)]"><td className="py-2 font-mono text-[var(--text-primary)]">{item.iface}</td><td className="text-right text-cyan-300">{item.rxRateLabel}</td><td className="text-right text-emerald-300">{item.txRateLabel}</td><td className="text-right text-[var(--text-secondary)]">{item.rxLabel}</td><td className="text-right text-[var(--text-secondary)]">{item.txLabel}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>

        <Card title={t("trafficPage.card.remote")}>
          {remoteLoading && !remoteServers ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
              {t("trafficPage.remoteSampling")}
            </div>
          ) : (remoteServers ?? []).length === 0 ? (
            <div className="text-sm text-[var(--text-muted)]">{t("trafficPage.noRemote")}</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(remoteServers ?? []).map((node) => (
                <div key={node.serverId} className="rounded-xl border border-[var(--border)] bg-black/20 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">{node.serverName}</div>
                      <div className="mt-1 text-[11px] text-[var(--text-muted)]">{node.host}</div>
                    </div>
                    {node.error ? (
                      <span className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[10px] text-rose-300">{t("trafficPage.badge.samplingFailed")}</span>
                    ) : node.primaryInterface ? (
                      <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">{t("trafficPage.badge.onlineIface").replace("{iface}", node.primaryInterface.iface)}</span>
                    ) : (
                      <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] text-[var(--text-secondary)]">{t("trafficPage.badge.noIface")}</span>
                    )}
                  </div>
                  {node.error ? (
                    <div className="mt-3 break-all text-[11px] text-rose-200/80">{node.error}</div>
                  ) : node.primaryInterface ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-cyan-500/10 px-3 py-2 text-cyan-300">
                          <div className="text-[10px] opacity-70">{t("trafficPage.rxShort")}</div>
                          <div className="text-sm font-semibold tabular-nums">{node.primaryInterface.rxRateLabel}</div>
                        </div>
                        <div className="rounded-lg bg-emerald-500/10 px-3 py-2 text-emerald-300">
                          <div className="text-[10px] opacity-70">{t("trafficPage.txShort")}</div>
                          <div className="text-sm font-semibold tabular-nums">{node.primaryInterface.txRateLabel}</div>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-[var(--text-secondary)]">
                        <div>{t("trafficPage.rxTotal").replace("{value}", node.primaryInterface.rxLabel)}<span className="font-mono text-[var(--text-secondary)]"> </span></div>
                        <div>{t("trafficPage.txTotal").replace("{value}", node.primaryInterface.txLabel)}<span className="font-mono text-[var(--text-secondary)]"> </span></div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-3 text-[11px] text-[var(--text-muted)]">{t("trafficPage.noPrimaryIface")}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </PageShell>
  );
}
