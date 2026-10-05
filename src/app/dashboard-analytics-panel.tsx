"use client";

import { useEffect, useMemo, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { formatBytes as formatBytesShared } from "@/lib/format/bytes";
import { formatShortTime } from "@/lib/datetime/format";
import { useI18n } from "@/lib/i18n/use-locale";
import { EmptyState } from "@/components/page-shell";
import { Notice } from "@/components/ui-primitives";
import { getErrorMessage } from "@/lib/http/error-message";

type ServerMetricPoint = {
  time: string;
  cpu: number;
  memory: number;
  disk: number;
};

type DownloadTrendPoint = {
  date: string;
  completed: number;
  failed: number;
  running: number;
  pending: number;
};

type AuditTrendPoint = {
  date: string;
  total: number;
};

type ImageBedTrendPoint = {
  date: string;
  count: number;
  size: number;
};

type DashboardAnalytics = {
  servers?: ServerMetricPoint[];
  downloads?: DownloadTrendPoint[];
  audit?: AuditTrendPoint[];
  imageBed?: ImageBedTrendPoint[];
};

function formatShortDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  return formatBytesShared(value);
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function DashboardAnalyticsPanel() {
  const { locale, t } = useI18n();
  const [data, setData] = useState<DashboardAnalytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    async function loadAnalytics() {
      try {
        setLoading(true);
        setError("");
        const result = await csrfFetch<DashboardAnalytics>("/api/dashboard/analytics?type=all");
        if (active) setData(result);
      } catch (err) {
        if (active) setError(getErrorMessage(err, t("dashboard.analytics.load-error")));
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAnalytics();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locale]);

  const latestServerMetric = data?.servers?.at(-1);
  const downloadTotals = useMemo(() => {
    return (data?.downloads ?? []).reduce(
      (acc, item) => ({
        completed: acc.completed + (item.completed ?? 0),
        failed: acc.failed + (item.failed ?? 0),
        running: acc.running + (item.running ?? 0),
        pending: acc.pending + (item.pending ?? 0),
      }),
      { completed: 0, failed: 0, running: 0, pending: 0 },
    );
  }, [data?.downloads]);

  return (
    <section data-surface-panel data-card className="mt-6 space-y-4 p-4 sm:p-5" aria-labelledby="dashboard-analytics-title">
      <div className="flex flex-col gap-2 border-b border-[var(--border-subtle)] pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="dashboard-analytics-title" className="text-[15px] font-semibold text-[var(--text-primary)]">{t("dashboard.data-trends")}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{t("dashboard.analytics.description")}</p>
        </div>
        {loading ? <span className="text-xs font-medium text-[var(--accent)]">{t("dashboard.analytics.loading")}</span> : null}
      </div>

      {error ? (
        <Notice tone="warning">{t("dashboard.analytics.unavailable")}: {error}</Notice>
      ) : null}

      {!loading && !error && data ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div data-inset className="p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-[var(--text-primary)]">{t("dashboard.analytics.server-trend")}</h3>
              {latestServerMetric ? <span className="text-xs text-[var(--text-muted)]">{t("dashboard.analytics.recent")} {formatShortTime(latestServerMetric.time, locale)}</span> : null}
            </div>
            {data.servers?.length ? (
              <div className="mt-4 space-y-3" data-testid="server-analytics-chart">
                <MetricLine label="CPU" value={clampPercent(latestServerMetric?.cpu ?? 0)} color="emerald" />
                <MetricLine label={t("monitoring.memory")} value={clampPercent(latestServerMetric?.memory ?? 0)} color="blue" />
                <MetricLine label={t("monitoring.disk")} value={clampPercent(latestServerMetric?.disk ?? 0)} color="amber" />
                <SparkBars
                  points={data.servers.map((point) => ({ label: formatShortTime(point.time, locale), value: Math.max(point.cpu, point.memory, point.disk) }))}
                  color="cyan"
                />
              </div>
            ) : (
              <EmptyAnalyticsState text={t("dashboard.analytics.no-server-metrics")} />
            )}
          </div>

          <div data-inset className="p-4">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">{t("dashboard.analytics.download-trend")}</h3>
            {data.downloads?.length ? (
              <div className="mt-4" data-testid="download-analytics-chart">
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <MiniStat label={t("dashboard.completed")} value={downloadTotals.completed} color="emerald" />
                  <MiniStat label={t("dashboard.failed")} value={downloadTotals.failed} color="rose" />
                  <MiniStat label={t("dashboard.running")} value={downloadTotals.running} color="cyan" />
                  <MiniStat label={t("dashboard.analytics.pending")} value={downloadTotals.pending} color="amber" />
                </div>
                <StackedDownloadBars points={data.downloads} />
              </div>
            ) : (
              <EmptyAnalyticsState text={t("dashboard.analytics.no-downloads")} />
            )}
          </div>

          <div data-inset className="p-4">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">{t("dashboard.analytics.audit-activity")}</h3>
            {data.audit?.length ? (
              <SparkBars points={data.audit.map((point) => ({ label: formatShortDate(point.date), value: point.total }))} color="violet" />
            ) : (
              <EmptyAnalyticsState text={t("dashboard.analytics.no-audit")} />
            )}
          </div>

          <div data-inset className="p-4">
            <h3 className="text-sm font-medium text-[var(--text-primary)]">{t("dashboard.analytics.image-bed")}</h3>
            {data.imageBed?.length ? (
              <div className="mt-4">
                <SparkBars points={data.imageBed.map((point) => ({ label: formatShortDate(point.date), value: point.count }))} color="pink" />
                <p className="mt-3 text-xs text-[var(--text-muted)]">
                  {t("dashboard.analytics.image-total-prefix")} {data.imageBed.reduce((sum, point) => sum + point.count, 0)} {t("dashboard.analytics.image-total-count-suffix")} / {formatBytes(data.imageBed.reduce((sum, point) => sum + point.size, 0))}
                </p>
              </div>
            ) : (
              <EmptyAnalyticsState text={t("dashboard.analytics.no-image-bed")} />
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MetricLine({ label, value, color }: { label: string; value: number; color: "emerald" | "blue" | "amber" }) {
  const colors = {
    emerald: "bg-[var(--chart-2)]",
    blue: "bg-[var(--chart-4)]",
    amber: "bg-[var(--chart-3)]",
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-secondary)]">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--surface-elevated)]">
        <div className={`h-full rounded-full ${colors[color]}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

/** Thin out x labels: show at most ~7 to prevent truncation on dense charts. */
function labelInterval(pointCount: number) {
  return Math.ceil(pointCount / 7);
}

/** Axis labels centred under their bars; only every few are shown. */
function AxisLabels({ labels }: { labels: string[] }) {
  const interval = labelInterval(labels.length);
  const last = labels.length - 1;
  // The final label is worth showing only when it does not collide with the
  // previous tick (e.g. 11:00 and 12:00 side by side).
  const showLast = last % interval === 0 || last % interval >= Math.ceil(interval * 0.6);
  return (
    <div className="relative mt-1.5 h-4" aria-hidden="true">
      {labels.map((label, index) => {
        if (!(index % interval === 0 || (index === last && showLast))) return null;
        const left = ((index + 0.5) / labels.length) * 100;
        return (
          <span
            key={`${label}-${index}`}
            className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[11px] tabular-nums text-[var(--text-muted)]"
            style={{ left: `${left}%` }}
          >
            {label}
          </span>
        );
      })}
    </div>
  );
}

function SparkBars({ points, color }: { points: Array<{ label: string; value: number }>; color: "cyan" | "violet" | "pink" }) {
  const { t } = useI18n();
  const max = Math.max(1, ...points.map((point) => point.value));
  const colors = {
    cyan: "bg-[var(--chart-1)]",
    violet: "bg-[var(--chart-5)]",
    pink: "bg-[var(--chart-4)]",
  };
  return (
    <div className="mt-4" aria-label={t("dashboardAnalytics.trendChart")}>
      <div className="flex h-20 items-end gap-[3px] border-b border-[var(--chart-grid)]">
        {points.map((point, index) => (
          <div
            key={`${point.label}-${index}`}
            className={`min-w-0 flex-1 rounded-t-sm opacity-85 transition-opacity hover:opacity-100 ${colors[color]}`}
            style={{ height: `${Math.max(4, (point.value / max) * 100)}%` }}
            title={`${point.label}: ${point.value}`}
          />
        ))}
      </div>
      <AxisLabels labels={points.map((point) => point.label)} />
    </div>
  );
}

function StackedDownloadBars({ points }: { points: DownloadTrendPoint[] }) {
  const { t } = useI18n();
  const max = Math.max(
    1,
    ...points.map((point) => point.completed + point.failed + point.running + point.pending),
  );
  return (
    <div className="mt-4" aria-label={t("dashboardAnalytics.downloadTrend")}>
      <div className="flex h-20 items-end gap-[3px] border-b border-[var(--chart-grid)]">
        {points.map((point) => {
          const total = point.completed + point.failed + point.running + point.pending;
          return (
            <div
              key={point.date}
              className="flex min-w-0 flex-1 flex-col justify-end overflow-hidden rounded-t-sm bg-[var(--surface-hover)]"
              style={{ height: `${Math.max(4, (total / max) * 100)}%` }}
              title={`${point.date}: ${total}`}
            >
              <Segment value={point.failed} total={total} className="bg-[var(--chart-6)]" />
              <Segment value={point.running} total={total} className="bg-[var(--chart-1)]" />
              <Segment value={point.pending} total={total} className="bg-[var(--chart-3)]" />
              <Segment value={point.completed} total={total} className="bg-[var(--chart-2)]" />
            </div>
          );
        })}
      </div>
      <AxisLabels labels={points.map((point) => formatShortDate(point.date))} />
    </div>
  );
}

function Segment({ value, total, className }: { value: number; total: number; className: string }) {
  if (value <= 0 || total <= 0) return null;
  return <div className={className} style={{ height: `${Math.max(8, (value / total) * 100)}%` }} />;
}

function MiniStat({ label, value, color }: { label: string; value: number; color: "emerald" | "rose" | "cyan" | "amber" }) {
  const colors = {
    emerald: "text-[var(--success)] border-[var(--success-border)] bg-[var(--success-bg)]",
    rose: "text-[var(--danger)] border-[var(--danger-border)] bg-[var(--danger-bg)]",
    cyan: "text-[var(--accent)] border-[var(--accent-border)] bg-[var(--accent-bg)]",
    amber: "text-[var(--warning)] border-[var(--warning-border)] bg-[var(--warning-bg)]",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 ${colors[color]}`}>
      <div className="text-xs opacity-75">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

function EmptyAnalyticsState({ text }: { text: string }) {
  return (
    <div className="mt-4">
      <EmptyState>{text}</EmptyState>
    </div>
  );
}
