"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PageShell, PageHeader, SurfacePanel } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useRefreshInterval } from "@/lib/preferences/use-refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatDateTime } from "@/lib/datetime/format";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";
import { TrafficSparkline, type TrafficSample } from "./traffic-sparkline";

import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { Notice, InlineLoading } from "@/components/ui-primitives";
import { getErrorMessage } from "@/lib/http/error-message";
const HISTORY_LIMIT = 60; // ≈ 30 min at 30s polling cadence

type HistoryScope = "live" | "24h" | "7d";

/** The live scope keeps the in-memory curve the summary poll builds; the other two read persisted samples. */
const SCOPE_BUTTONS: ReadonlyArray<{
  scope: HistoryScope;
  label?: string;
  labelKey?: string;
}> = [
  { scope: "live", labelKey: "trafficPage.historyScopeLive" },
  { scope: "24h", label: "24h" },
  { scope: "7d", label: "7d" },
];

const HISTORY_HINT_KEYS: Record<HistoryScope, string> = {
  live: "trafficPage.historyHintLive",
  "24h": "trafficPage.historyHint24h",
  "7d": "trafficPage.historyHint7d",
};

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

/**
 * One row of /api/traffic/history. Unlike {@link TrafficSample}, whose `t` is
 * milliseconds for the sparkline, the API hands back an ISO timestamp — this type
 * used to intersect TrafficSample and so claimed `t: number` for a string value.
 */
export type TrafficHistoryPoint = {
  source: string;
  serverId: string | null;
  iface: string;
  /** ISO-8601 sample timestamp. */
  t: string;
  rx: number;
  tx: number;
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <SurfacePanel title={title}>
      {children}
    </SurfacePanel>
  );
}

function RateBadge({ label, value, color }: { label: string; value: string; color: "cyan" | "emerald" }) {
  const styles = color === "cyan" ? "border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]" : "border border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]";
  return (
    <div className={`rounded-2xl px-4 py-3 ${styles}`}>
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums ">{value}</div>
    </div>
  );
}

/**
 * One curve per interface (24h) or per interface and local calendar day (7d).
 * The interface has to be part of the key: two interfaces interleaved into one
 * sparkline read as a saw-tooth that belongs to neither.
 */
export function groupHistory(points: TrafficHistoryPoint[], scope: "24h" | "7d") {
  const grouped = new Map<string, TrafficHistoryPoint[]>();
  for (const point of points) {
    let key = point.iface;
    if (scope === "7d") {
      const d = new Date(point.t);
      // Group by LOCAL calendar date (not UTC) so day boundaries match the
      // viewer's timezone — otherwise points after 16:00 UTC land on the wrong day for UTC+8.
      const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      key = `${point.iface} · ${day}`;
    }
    const list = grouped.get(key) ?? [];
    list.push(point);
    grouped.set(key, list);
  }
  return grouped;
}

export default function TrafficPage() {
  const { t, locale } = useI18n();
  const [summary, setSummary] = useState<TrafficSummary | null>(null);
  const [remoteServers, setRemoteServers] = useState<RemoteServerTraffic[] | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [selectedIface, setSelectedIface] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshIntervalSeconds = useRefreshInterval(30);
  // Two independent series. `liveSamples` is the rolling in-memory curve fed by
  // the summary poll; `persistedHistory` is what /api/traffic/history returns.
  // They used to share one state field, so every refresh overwrote the persisted
  // curve with the live one and back again, and the "last 24 hours" view was in
  // fact whichever of the two answered last.
  const [liveSamples, setLiveSamples] = useState<TrafficSample[]>([]);
  const [persistedHistory, setPersistedHistory] = useState<TrafficHistoryPoint[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [historyScope, setHistoryScope] = useState<HistoryScope>("live");
  const lastIfaceRef = useRef<string>("");

  const historyRequestRef = useRef<AbortController | null>(null);
  const summaryRequestRef = useRef<AbortController | null>(null);
  const remoteRequestRef = useRef<AbortController | null>(null);

  const fetchHistory = useCallback(async (scope: Exclude<HistoryScope, "live">, iface = selectedIface) => {
    historyRequestRef.current?.abort();
    const controller = new AbortController();
    historyRequestRef.current = controller;
    try {
      const params = new URLSearchParams();
      params.set("hours", scope === "24h" ? "24" : "168");
      // This chart sits under the hub's own rx/tx badges, so it must only carry
      // hub samples. Without the filter every visible server's snapshots came
      // back too and interleaved into the curve — `eth0` is the primary
      // interface name on the hub and on most VPS alike.
      params.set("source", "local");
      if (iface) params.set("iface", iface);
      const data = (await csrfFetch(
        `/api/traffic/history?${params.toString()}`,
        { signal: controller.signal },
      )) as { history?: TrafficHistoryPoint[]; error?: string };
      if (data.error || !Array.isArray(data.history)) {
        setHistoryError(data.error || t("trafficPage.historyLoadFailed"));
        return;
      }
      setHistoryError("");
      setPersistedHistory(data.history);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setHistoryError(getErrorMessage(cause, t("trafficPage.historyLoadFailed")));
    } finally {
      if (historyRequestRef.current === controller) {
        historyRequestRef.current = null;
      }
    }
  }, [selectedIface, t]);

  const fetchSummary = useCallback(async (iface = selectedIface) => {
    summaryRequestRef.current?.abort();
    const controller = new AbortController();
    summaryRequestRef.current = controller;
    try {
      const params = new URLSearchParams();
      if (iface) params.set("iface", iface);
      const data = (await csrfFetch(
        `/api/traffic/summary${params.toString() ? `?${params}` : ""}`,
        { signal: controller.signal },
      )) as TrafficSummary & { error?: string };
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
          setLiveSamples([{ t: Date.now(), rx: prim.rxRateBytesPerSecond, tx: prim.txRateBytesPerSecond }]);
        } else {
          setLiveSamples((prev) => {
            const next = [...prev, { t: Date.now(), rx: prim.rxRateBytesPerSecond, tx: prim.txRateBytesPerSecond }];
            return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
          });
        }
      }
    } catch {
      if (controller.signal.aborted) return;
      setError(t("trafficPage.error.fetch"));
    } finally {
      if (summaryRequestRef.current === controller) {
        summaryRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [selectedIface, t]);

  const fetchRemote = useCallback(async () => {
    remoteRequestRef.current?.abort();
    const controller = new AbortController();
    remoteRequestRef.current = controller;
    setRemoteLoading(true);
    try {
      const data = (await csrfFetch(`/api/traffic/summary?include=remote`, {
        signal: controller.signal,
      })) as TrafficSummary & { error?: string };
      if (data.error) return;
      setRemoteServers(data.remoteServers ?? []);
    } catch {
      if (controller.signal.aborted) return;
      // soft-fail
    } finally {
      if (remoteRequestRef.current === controller) {
        remoteRequestRef.current = null;
        setRemoteLoading(false);
      }
    }
  }, []);

  useEffect(() => () => {
      historyRequestRef.current?.abort();
      summaryRequestRef.current?.abort();
      remoteRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchSummary();
      if (historyScope !== "live") void fetchHistory(historyScope);
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchHistory, fetchSummary, historyScope]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchRemote(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchRemote]);
  useVisibilityInterval(() => {
    void fetchSummary();
    void fetchRemote();
    if (historyScope !== "live") void fetchHistory(historyScope);
  }, autoRefresh && refreshIntervalSeconds > 0 ? refreshIntervalSeconds * 1000 : null);

  const primary = summary?.currentServer.primaryInterface ?? null;
  const refreshLabel = getRefreshIntervalLabel(refreshIntervalSeconds);
  const persistedTrend = useMemo(() => {
    if (historyScope === "live") return null;
    return groupHistory(persistedHistory, historyScope);
  }, [persistedHistory, historyScope]);

  return (
    <PageShell>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <PageHeader eyebrow={t("trafficPage.eyebrow")} title={t("trafficPage.title")} description={t("trafficPage.desc")} />
        </div>
        <div className="flex items-center gap-2">
          <ActionButton type="button" variant="ghost" onClick={() => fetchSummary()} className="text-xs">{t("trafficPage.refresh")}</ActionButton>
          <button type="button" onClick={() => setAutoRefresh((v) => !v)} disabled={refreshIntervalSeconds <= 0} className={`rounded-lg px-3 py-1.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50 ${autoRefresh ? "bg-[var(--success-bg)] text-[var(--success)]" : "bg-[var(--surface-hover)]/60 text-[var(--text-secondary)]"}`}>
            {autoRefresh
              ? t("trafficPage.autoRefreshOn", { label: refreshLabel })
              : refreshIntervalSeconds <= 0
                ? t("trafficPage.autoRefreshOff")
                : t("trafficPage.autoRefreshPaused", { label: refreshLabel })}
          </button>
        </div>
      </div>

      {error && <Notice tone="danger">{error}</Notice>}
      {historyError && <Notice tone="danger">{historyError}</Notice>}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {SCOPE_BUTTONS.map(({ scope, label, labelKey }) => (
          <button
            key={scope}
            type="button"
            aria-pressed={historyScope === scope}
            onClick={() => {
              setHistoryScope(scope);
              if (scope !== "live") void fetchHistory(scope);
            }}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium ${historyScope === scope ? "bg-[var(--color-action)]/15 text-[var(--text-secondary)]" : "bg-[var(--surface-elevated)] text-[var(--text-secondary)]"}`}
          >
            {labelKey ? t(labelKey) : label}
          </button>
        ))}
        <span className="text-xs text-[var(--text-muted)]">{t(HISTORY_HINT_KEYS[historyScope])}</span>
      </div>

      <div className="space-y-5">
        <Card title={t("trafficPage.card.realtime")}>
          {loading && !summary ? (
            <InlineLoading label={t("trafficPage.loading")} />
          ) : summary ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="text-xs text-[var(--text-muted)]" htmlFor="trafficIface">{t("trafficPage.iface.label")}</label>
                <select id="trafficIface" value={selectedIface} onChange={(e) => setSelectedIface(e.target.value)} className="rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
                  <option value="">{t("trafficPage.iface.auto")}</option>
                  {summary.currentServer.interfaces.map((item) => <option key={item.iface} value={item.iface}>{item.iface}</option>)}
                </select>
                <span className="text-xs text-[var(--text-muted)]">{t("trafficPage.lastUpdated", { date: formatDateTime(summary.timestamp, locale) })}</span>
              </div>
              {primary ? (
                <>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <RateBadge label={t("trafficPage.rxRate", { iface: primary.iface })} value={primary.rxRateLabel} color="cyan" />
                    <RateBadge label={t("trafficPage.txRate", { iface: primary.iface })} value={primary.txRateLabel} color="emerald" />
                  </div>
                  <div className="mt-4">
                    {historyScope === "live" ? (
                      <TrafficSparkline
                        samples={liveSamples}
                        labels={{
                          rx: t("trafficPage.rxShort"),
                          tx: t("trafficPage.txShort"),
                          empty: t("trafficPage.chart.empty"),
                          windowHint: t("trafficPage.chart.windowHint"),
                        }}
                      />
                    ) : (
                      <div className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-3">
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
                    <div className="rounded-xl bg-[var(--input-bg)] p-3 light:ring-1 light:ring-[var(--border-strong)]">{t("trafficPage.rxTotal", { value: primary.rxLabel })}<span className="font-mono text-[var(--text-primary)]"> </span></div>
                    <div className="rounded-xl bg-[var(--input-bg)] p-3 light:ring-1 light:ring-[var(--border-strong)]">{t("trafficPage.txTotal", { value: primary.txLabel })}<span className="font-mono text-[var(--text-primary)]"> </span></div>
                  </div>
                </>
              ) : <div className="text-sm text-[var(--text-muted)]">{t("trafficPage.noIface")}</div>}
            </>
          ) : null}
        </Card>

        <Card title={t("trafficPage.card.detail")}>
          {loading && !summary ? (
            <InlineLoading label={t("trafficPage.loading")} />
          ) : summary ? (
            <div className="overflow-x-auto" tabIndex={0}>
              <table className="w-full text-xs">
                <thead className="text-[var(--text-muted)]"><tr><th className="py-2 text-left">{t("trafficPage.th.iface")}</th><th className="text-right">{t("trafficPage.th.rxRate")}</th><th className="text-right">{t("trafficPage.th.txRate")}</th><th className="text-right">{t("trafficPage.th.rxTotal")}</th><th className="text-right">{t("trafficPage.th.txTotal")}</th></tr></thead>
                <tbody>
                  {summary.currentServer.interfaces.map((item) => <tr key={item.iface} className="border-t border-[var(--border)]"><td className="py-2 font-mono text-[var(--text-primary)]">{item.iface}</td><td className="text-right text-[var(--color-action)]">{item.rxRateLabel}</td><td className="text-right text-[var(--success)]">{item.txRateLabel}</td><td className="text-right text-[var(--text-secondary)]">{item.rxLabel}</td><td className="text-right text-[var(--text-secondary)]">{item.txLabel}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>

        <Card title={t("trafficPage.card.remote")}>
          {remoteLoading && !remoteServers ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-action-bg)]" />
              {t("trafficPage.remoteSampling")}
            </div>
          ) : (remoteServers ?? []).length === 0 ? (
            <div className="text-sm text-[var(--text-muted)]">{t("trafficPage.noRemote")}</div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(remoteServers ?? []).map((node) => (
                <div key={node.serverId} className="rounded-xl border border-[var(--input-border)] bg-[var(--input-bg)] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-medium text-[var(--text-primary)]">{node.serverName}</div>
                      <div className="mt-1 text-xs text-[var(--text-muted)]">{node.host}</div>
                    </div>
                    <StatusBadge
                      tone={node.error ? "danger" : node.primaryInterface ? "success" : "neutral"}
                      size="sm"
                    >
                      {node.error
                        ? t("trafficPage.badge.samplingFailed")
                        : node.primaryInterface
                          ? t("trafficPage.badge.onlineIface", { iface: node.primaryInterface.iface })
                          : t("trafficPage.badge.noIface")}
                    </StatusBadge>
                  </div>
                  {node.error ? (
                    <div className="mt-3 break-all text-xs text-[var(--danger)]">{node.error}</div>
                  ) : node.primaryInterface ? (
                    <>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <div className="rounded-lg bg-[var(--color-action)]/10 px-3 py-2 text-[var(--color-action)]">
                          <div className="text-xs opacity-70">{t("trafficPage.rxShort")}</div>
                          <div className="text-sm font-semibold tabular-nums">{node.primaryInterface.rxRateLabel}</div>
                        </div>
                        <div className="rounded-lg bg-[var(--success-bg)] px-3 py-2 text-[var(--success)]">
                          <div className="text-xs opacity-70">{t("trafficPage.txShort")}</div>
                          <div className="text-sm font-semibold tabular-nums">{node.primaryInterface.txRateLabel}</div>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)]">
                        <div>{t("trafficPage.rxTotal", { value: node.primaryInterface.rxLabel })}<span className="font-mono text-[var(--text-secondary)]"> </span></div>
                        <div>{t("trafficPage.txTotal", { value: node.primaryInterface.txLabel })}<span className="font-mono text-[var(--text-secondary)]"> </span></div>
                      </div>
                    </>
                  ) : (
                    <div className="mt-3 text-xs text-[var(--text-muted)]">{t("trafficPage.noPrimaryIface")}</div>
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
