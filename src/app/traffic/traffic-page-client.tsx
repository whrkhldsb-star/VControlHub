"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, PageShell, PageHeader, SurfacePanel } from "@/components/page-shell";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { getRefreshIntervalLabel } from "@/lib/preferences/refresh-interval";
import { useRefreshInterval } from "@/lib/preferences/use-refresh-interval";
import { useI18n } from "@/lib/i18n/use-locale";
import { formatDateTime } from "@/lib/datetime/format";
import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";
import { TrafficChart, type TrafficSample } from "./traffic-chart";

import { ActionButton, ButtonLink } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { Chip, InlineLoading, Notice, SegmentedControl } from "@/components/ui-primitives";
import { getErrorMessage } from "@/lib/http/error-message";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { Activity } from "@/components/icons";
/** The live tab polls the local counters on its own short cadence (cheap: /proc, no remote calls). */
const LIVE_POLL_MS = 5_000;
const HISTORY_LIMIT = 120; // 10 minutes at the 5 s live cadence

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
  /** Set when the fleet exceeds the sampling caps (200 servers / 100 storage nodes). */
  truncated?: { servers: boolean; storageNodes: boolean };
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

/** Current rate tile; the dot and figure use the same colour as the chart series. */
function RateBadge({ label, value, color }: { label: string; value: string; color: "cyan" | "emerald" }) {
  const series = color === "cyan" ? "var(--accent)" : "var(--success)";
  return (
    <div data-tile className="px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--text-muted)]">
        <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: series }} />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums" style={{ color: series }}>{value}</div>
    </div>
  );
}

/**
 * One curve per interface (24h) or per interface and calendar day (7d).
 * The interface has to be part of the key: two interfaces interleaved into one
 * sparkline read as a saw-tooth that belongs to neither.
 */
export function groupHistory(points: TrafficHistoryPoint[], scope: "24h" | "7d") {
  const grouped = new Map<string, TrafficHistoryPoint[]>();
  for (const point of points) {
    let key = point.iface;
    if (scope === "7d") {
      // The day of the application's zone, the one the times under each curve are written in. With the
      // browser's own day, a curve named for one day ran across midnight on its own axis when seen from
      // another zone.
      key = `${point.iface} · ${appTimeZoneDateKey(new Date(point.t))}`;
    }
    const list = grouped.get(key) ?? [];
    list.push(point);
    grouped.set(key, list);
  }
  return grouped;
}

export default function TrafficPage({ showHubTraffic = true }: { showHubTraffic?: boolean } = {}) {
  const { t, locale } = useI18n();
  const [summary, setSummary] = useState<TrafficSummary | null>(null);
  const [remoteServers, setRemoteServers] = useState<RemoteServerTraffic[] | null>(null);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const [remoteTruncated, setRemoteTruncated] = useState(false);
  const { state: urlState, setField: setUrlField } = useUrlQueryState({
    range: "live",
    iface: "",
  });
  const historyScope: HistoryScope =
    urlState.range === "24h" || urlState.range === "7d" ? urlState.range : "live";
  const setHistoryScope = (scope: HistoryScope) => setUrlField("range", scope);
  const selectedIface = urlState.iface || "";
  const setSelectedIface = (iface: string) => setUrlField("iface", iface);
  const [loading, setLoading] = useState(showHubTraffic);
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const refreshIntervalSeconds = useRefreshInterval(30);
  // Two independent series. `liveSamples` is the rolling in-memory curve fed by
  // the summary poll; `persistedHistory` is keyed by `{scope, iface}` so switching
  // 24h -> 7d never regroups stale 24h points under the 7d range.
  const [liveSamples, setLiveSamples] = useState<TrafficSample[]>([]);
  const [persistedHistory, setPersistedHistory] = useState<{
    scope: Exclude<HistoryScope, "live">;
    iface: string;
    points: TrafficHistoryPoint[];
  } | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const lastIfaceRef = useRef<string>("");

  const historyRequestRef = useRef<AbortController | null>(null);
  const summaryRequestRef = useRef<AbortController | null>(null);
  const remoteRequestRef = useRef<AbortController | null>(null);

  const fetchHistory = useCallback(async (scope: Exclude<HistoryScope, "live">, iface = selectedIface) => {
    historyRequestRef.current?.abort();
    const controller = new AbortController();
    historyRequestRef.current = controller;
    setHistoryLoading(true);
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
      setPersistedHistory({ scope, iface, points: data.history });
    } catch (cause) {
      if (controller.signal.aborted) return;
      setHistoryError(getErrorMessage(cause, t("trafficPage.historyLoadFailed")));
    } finally {
      if (historyRequestRef.current === controller) {
        historyRequestRef.current = null;
        setHistoryLoading(false);
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
        // Without an earlier counter reading the server reports a rate of 0
        // over 0 seconds; plotting it drew a ramp up from a zero that never was.
        const sample = prim.intervalSeconds > 0 ? [{ t: Date.now(), rx: prim.rxRateBytesPerSecond, tx: prim.txRateBytesPerSecond }] : [];
        if (lastIfaceRef.current !== ifaceKey) {
          lastIfaceRef.current = ifaceKey;
          setLiveSamples(sample);
        } else if (sample.length) {
          setLiveSamples((prev) => {
            const next = [...prev, ...sample];
            return next.length > HISTORY_LIMIT ? next.slice(-HISTORY_LIMIT) : next;
          });
        }
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      // With the reason: a permission taken away read the same as a server that did not answer.
      setError(getErrorMessage(cause, t("trafficPage.error.fetch")));
    } finally {
      if (summaryRequestRef.current === controller) {
        summaryRequestRef.current = null;
        setLoading(false);
      }
    }
  }, [selectedIface, t]);

  const fetchRemote = useCallback(async () => {
    // Remote sampling walks the servers five at a time and can take longer
    // than the refresh interval. Cancelling the pending read on every tick
    // meant none ever finished and the panel stayed "sampling"; let it
    // finish and skip the tick instead.
    if (remoteRequestRef.current) return;
    const controller = new AbortController();
    remoteRequestRef.current = controller;
    setRemoteLoading(true);
    try {
      const data = (await csrfFetch(`/api/traffic/summary?include=remote`, {
        signal: controller.signal,
      })) as TrafficSummary & { error?: string };
      if (data.error) {
        setRemoteError(data.error);
        return;
      }
      setRemoteError("");
      setRemoteServers(data.remoteServers ?? []);
      setRemoteTruncated(Boolean(data.truncated?.servers));
    } catch (cause) {
      if (controller.signal.aborted) return;
      // Said in the card. Kept quiet, a first read that failed left the list empty and the card reporting
      // that no server was enabled; a later one leaves the last readings in place under the reason.
      setRemoteError(getErrorMessage(cause, t("trafficPage.remoteFailed")));
    } finally {
      if (remoteRequestRef.current === controller) {
        remoteRequestRef.current = null;
        setRemoteLoading(false);
      }
    }
  }, [t]);

  useEffect(() => () => {
      historyRequestRef.current?.abort();
      summaryRequestRef.current?.abort();
      remoteRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    if (!showHubTraffic) return;
    const timer = setTimeout(() => {
      void fetchSummary();
      if (historyScope !== "live") void fetchHistory(historyScope);
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchHistory, fetchSummary, historyScope, showHubTraffic]);

  useEffect(() => {
    const timer = setTimeout(() => { void fetchRemote(); }, 0);
    return () => clearTimeout(timer);
  }, [fetchRemote]);
  const autoRefreshing = autoRefresh && refreshIntervalSeconds > 0;
  useVisibilityInterval(() => {
    // The live tab refreshes the summary on its own cadence below.
    if (showHubTraffic && historyScope !== "live") {
      void fetchSummary();
      void fetchHistory(historyScope);
    }
    void fetchRemote();
  }, autoRefreshing ? refreshIntervalSeconds * 1000 : null);
  // A "real-time" curve fed every 30 s took a minute to show a line and
  // moved in steps; the live tab samples every 5 s while it is on screen.
  useVisibilityInterval(() => {
    void fetchSummary();
  }, showHubTraffic && autoRefreshing && historyScope === "live" ? LIVE_POLL_MS : null);

  // Everything the page shows: refreshing the summary alone left the remote
  // readings and the history curve as they were (and with manual refresh
  // nothing else would update them).
  const refreshAll = () => {
    if (showHubTraffic) {
      void fetchSummary();
      if (historyScope !== "live") void fetchHistory(historyScope);
    }
    void fetchRemote();
  };

  const primary = summary?.currentServer.primaryInterface ?? null;
  const refreshLabel = getRefreshIntervalLabel(refreshIntervalSeconds, t);
  const persistedMatches =
    historyScope !== "live" &&
    persistedHistory !== null &&
    persistedHistory.scope === historyScope &&
    persistedHistory.iface === selectedIface;
  const persistedTrend = useMemo(() => {
    if (historyScope === "live" || !persistedMatches || !persistedHistory) return null;
    return groupHistory(persistedHistory.points, historyScope);
  }, [persistedHistory, persistedMatches, historyScope]);

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("trafficPage.eyebrow")}
        title={t("trafficPage.title")}
        description={showHubTraffic ? t("trafficPage.desc") : t("trafficPage.descCustomer")}
      >
        <ActionButton size="sm" type="button" variant="ghost" onClick={refreshAll}>{t("trafficPage.refresh")}</ActionButton>
        <Chip size="md" tone="success" selected={autoRefresh} onClick={() => setAutoRefresh((v) => !v)} disabled={refreshIntervalSeconds <= 0}>
          {autoRefresh
            ? t("trafficPage.autoRefreshOn", { label: refreshLabel })
            : refreshIntervalSeconds <= 0
              ? t("trafficPage.autoRefreshOff")
              : t("trafficPage.autoRefreshPaused", { label: refreshLabel })}
        </Chip>
      </PageHeader>

      {error && <Notice tone="danger">{error}</Notice>}
      {historyError && <Notice tone="danger">{historyError}</Notice>}
      {remoteTruncated || (summary?.truncated && (summary.truncated.servers || summary.truncated.storageNodes)) ? <Notice tone="warning">{t("trafficPage.truncated")}</Notice> : null}

      {showHubTraffic ? (
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <SegmentedControl
            size="sm"
            ariaLabel={t("trafficPage.historyScopeLabel")}
            value={historyScope}
            onChange={(scope) => {
              setHistoryScope(scope);
              if (scope !== "live") void fetchHistory(scope);
            }}
            options={SCOPE_BUTTONS.map(({ scope, label, labelKey }) => ({ value: scope, label: labelKey ? t(labelKey) : label }))}
          />
          <span className="text-xs text-[var(--text-muted)]">{t(HISTORY_HINT_KEYS[historyScope])}</span>
        </div>
      ) : null}

      <div className="space-y-5">
        {showHubTraffic ? (
          <>
        <Card title={t("trafficPage.card.realtime")}>
          {loading && !summary ? (
            <InlineLoading label={t("trafficPage.loading")} />
          ) : summary ? (
            <>
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <label className="ui-label" htmlFor="trafficIface">{t("trafficPage.iface.label")}</label>
                <select id="trafficIface" value={selectedIface} onChange={(e) => setSelectedIface(e.target.value)} className={cn(UI_INPUT, "w-auto text-xs")}>
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
                      <TrafficChart samples={liveSamples} live />
                    ) : historyLoading && !persistedMatches ? (
                      <InlineLoading label={t("trafficPage.loading")} />
                    ) : persistedTrend && persistedTrend.size > 0 ? (
                      <div className="space-y-5">
                        {Array.from(persistedTrend.entries()).map(([key, points]) => (
                          <section key={key} aria-label={key}>
                            <h3 className="ui-title-caption mb-2">{key}</h3>
                            <TrafficChart samples={points.map((point) => ({ t: new Date(point.t).getTime(), rx: point.rx, tx: point.tx }))} />
                          </section>
                        ))}
                      </div>
                    ) : historyError ? (
                      <Notice tone="danger" compact action={{ label: t("common.retry"), onClick: () => void fetchHistory(historyScope) }}>
                        {historyError}
                      </Notice>
                    ) : (
                      <EmptyState icon={<Activity size={20} />} text={t("trafficPage.chart.emptyHistory")} />
                    )}
                  </div>
                  <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-[var(--text-secondary)] md:grid-cols-2">
                    <div data-inset="" className="p-3">{t("trafficPage.rxTotal", { value: primary.rxLabel })}</div>
                    <div data-inset="" className="p-3">{t("trafficPage.txTotal", { value: primary.txLabel })}</div>
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
                  {summary.currentServer.interfaces.map((item) => <tr key={item.iface} className="border-t border-[var(--border)]"><td className="py-2 font-mono text-[var(--text-primary)]">{item.iface}</td><td className="text-right font-mono tabular-nums text-[var(--text-primary)]">{item.rxRateLabel}</td><td className="text-right font-mono tabular-nums text-[var(--text-primary)]">{item.txRateLabel}</td><td className="text-right font-mono tabular-nums text-[var(--text-secondary)]">{item.rxLabel}</td><td className="text-right font-mono tabular-nums text-[var(--text-secondary)]">{item.txLabel}</td></tr>)}
                </tbody>
              </table>
            </div>
          ) : null}
        </Card>
          </>
        ) : null}

        <Card title={t("trafficPage.card.remote")}>
          {remoteError ? <Notice tone="danger" compact className="mb-3">{remoteError}</Notice> : null}
          {remoteLoading && !remoteServers ? (
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--color-action-bg)]" />
              {t("trafficPage.remoteSampling")}
            </div>
          ) : !remoteServers ? null : remoteServers.length === 0 ? (
            <EmptyState
              icon={<Activity size={20} />}
              text={t("trafficPage.noRemote")}
              action={<ButtonLink href="/servers" size="sm" variant="secondary">{t("trafficPage.gotoServers")}</ButtonLink>}
            />
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {(remoteServers ?? []).map((node) => (
                <div data-inset="" key={node.serverId} className="p-4">
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
                        <div className="rounded-lg bg-[var(--surface-elevated)] px-3 py-2 text-[var(--text-primary)]">
                          <div className="text-xs text-[var(--text-muted)]">{t("trafficPage.rxShort")}</div>
                          <div className="text-sm font-semibold tabular-nums">{node.primaryInterface.rxRateLabel}</div>
                        </div>
                        <div className="rounded-lg bg-[var(--surface-elevated)] px-3 py-2 text-[var(--text-primary)]">
                          <div className="text-xs text-[var(--text-muted)]">{t("trafficPage.txShort")}</div>
                          <div className="text-sm font-semibold tabular-nums">{node.primaryInterface.txRateLabel}</div>
                        </div>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)]">
                        <div>{t("trafficPage.rxTotal", { value: node.primaryInterface.rxLabel })}</div>
                        <div>{t("trafficPage.txTotal", { value: node.primaryInterface.txLabel })}</div>
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
