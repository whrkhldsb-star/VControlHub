"use client";

import { useEffect, useMemo, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";

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

function formatShortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size >= 10 || index === 0 ? Math.round(size) : size.toFixed(1)} ${units[index]}`;
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function DashboardAnalyticsPanel() {
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
        if (active) setError(err instanceof Error ? err.message : "获取趋势数据失败");
      } finally {
        if (active) setLoading(false);
      }
    }

    loadAnalytics();
    return () => {
      active = false;
    };
  }, []);

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
    <section className="mt-8 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4" aria-labelledby="dashboard-analytics-title">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 id="dashboard-analytics-title" className="text-lg font-semibold text-white">数据趋势</h2>
          <p className="mt-1 text-xs text-slate-500">来自 /api/dashboard/analytics 的近 24 小时节点、7 天游下载、审计与图床趋势。</p>
        </div>
        {loading ? <span className="text-xs text-cyan-300">正在加载趋势…</span> : null}
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100" role="alert">
          趋势数据暂不可用：{error}
        </div>
      ) : null}

      {!loading && !error && data ? (
        <div className="mt-4 grid gap-4 xl:grid-cols-2">
          <div className="rounded-xl border border-white/[0.05] bg-slate-950/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium text-white/80">VPS 资源趋势（24h）</h3>
              {latestServerMetric ? <span className="text-xs text-slate-500">最近 {formatShortTime(latestServerMetric.time)}</span> : null}
            </div>
            {data.servers?.length ? (
              <div className="mt-4 space-y-3" data-testid="server-analytics-chart">
                <MetricLine label="CPU" value={clampPercent(latestServerMetric?.cpu ?? 0)} color="emerald" />
                <MetricLine label="内存" value={clampPercent(latestServerMetric?.memory ?? 0)} color="blue" />
                <MetricLine label="磁盘" value={clampPercent(latestServerMetric?.disk ?? 0)} color="amber" />
                <SparkBars
                  points={data.servers.map((point) => ({ label: formatShortTime(point.time), value: Math.max(point.cpu, point.memory, point.disk) }))}
                  color="cyan"
                />
              </div>
            ) : (
              <EmptyAnalyticsState text="暂无节点指标快照。" />
            )}
          </div>

          <div className="rounded-xl border border-white/[0.05] bg-slate-950/40 p-4">
            <h3 className="text-sm font-medium text-white/80">下载任务趋势（7d）</h3>
            {data.downloads?.length ? (
              <div className="mt-4" data-testid="download-analytics-chart">
                <div className="grid grid-cols-4 gap-2 text-xs">
                  <MiniStat label="完成" value={downloadTotals.completed} color="emerald" />
                  <MiniStat label="失败" value={downloadTotals.failed} color="rose" />
                  <MiniStat label="运行" value={downloadTotals.running} color="cyan" />
                  <MiniStat label="等待" value={downloadTotals.pending} color="amber" />
                </div>
                <StackedDownloadBars points={data.downloads} />
              </div>
            ) : (
              <EmptyAnalyticsState text="近 7 天暂无下载任务。" />
            )}
          </div>

          <div className="rounded-xl border border-white/[0.05] bg-slate-950/40 p-4">
            <h3 className="text-sm font-medium text-white/80">审计活动（30d）</h3>
            {data.audit?.length ? (
              <SparkBars points={data.audit.map((point) => ({ label: formatShortDate(point.date), value: point.total }))} color="violet" />
            ) : (
              <EmptyAnalyticsState text="近 30 天暂无审计活动。" />
            )}
          </div>

          <div className="rounded-xl border border-white/[0.05] bg-slate-950/40 p-4">
            <h3 className="text-sm font-medium text-white/80">图床上传（7d）</h3>
            {data.imageBed?.length ? (
              <div className="mt-4">
                <SparkBars points={data.imageBed.map((point) => ({ label: formatShortDate(point.date), value: point.count }))} color="pink" />
                <p className="mt-3 text-xs text-slate-500">
                  最近累计 {data.imageBed.reduce((sum, point) => sum + point.count, 0)} 张 / {formatBytes(data.imageBed.reduce((sum, point) => sum + point.size, 0))}
                </p>
              </div>
            ) : (
              <EmptyAnalyticsState text="近 7 天暂无图床上传。" />
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function MetricLine({ label, value, color }: { label: string; value: number; color: "emerald" | "blue" | "amber" }) {
  const colors = {
    emerald: "bg-emerald-400",
    blue: "bg-blue-400",
    amber: "bg-amber-400",
  };
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/5">
        <div className={`h-full rounded-full ${colors[color]}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

function SparkBars({ points, color }: { points: Array<{ label: string; value: number }>; color: "cyan" | "violet" | "pink" }) {
  const max = Math.max(1, ...points.map((point) => point.value));
  const colors = {
    cyan: "bg-cyan-400/70",
    violet: "bg-violet-400/70",
    pink: "bg-pink-400/70",
  };
  return (
    <div className="mt-4 flex h-24 items-end gap-1" aria-label="趋势柱状图">
      {points.map((point, index) => (
        <div key={`${point.label}-${index}`} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div
            className={`w-full rounded-t ${colors[color]}`}
            style={{ height: `${Math.max(6, (point.value / max) * 88)}px` }}
            title={`${point.label}: ${point.value}`}
          />
          <span className="max-w-full truncate text-[10px] text-slate-600">{point.label}</span>
        </div>
      ))}
    </div>
  );
}

function StackedDownloadBars({ points }: { points: DownloadTrendPoint[] }) {
  const max = Math.max(
    1,
    ...points.map((point) => point.completed + point.failed + point.running + point.pending),
  );
  return (
    <div className="mt-4 flex h-24 items-end gap-1" aria-label="下载趋势柱状图">
      {points.map((point) => {
        const total = point.completed + point.failed + point.running + point.pending;
        const height = Math.max(6, (total / max) * 88);
        return (
          <div key={point.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div className="flex w-full flex-col justify-end overflow-hidden rounded-t bg-white/5" style={{ height: `${height}px` }} title={`${point.date}: ${total}`}>
              <Segment value={point.failed} total={total} className="bg-rose-400/70" />
              <Segment value={point.running} total={total} className="bg-cyan-400/70" />
              <Segment value={point.pending} total={total} className="bg-amber-400/70" />
              <Segment value={point.completed} total={total} className="bg-emerald-400/70" />
            </div>
            <span className="max-w-full truncate text-[10px] text-slate-600">{formatShortDate(point.date)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Segment({ value, total, className }: { value: number; total: number; className: string }) {
  if (value <= 0 || total <= 0) return null;
  return <div className={className} style={{ height: `${Math.max(8, (value / total) * 100)}%` }} />;
}

function MiniStat({ label, value, color }: { label: string; value: number; color: "emerald" | "rose" | "cyan" | "amber" }) {
  const colors = {
    emerald: "text-emerald-200 border-emerald-400/20 bg-emerald-400/10",
    rose: "text-rose-200 border-rose-400/20 bg-rose-400/10",
    cyan: "text-cyan-200 border-cyan-400/20 bg-cyan-400/10",
    amber: "text-amber-200 border-amber-400/20 bg-amber-400/10",
  };
  return (
    <div className={`rounded-lg border px-3 py-2 ${colors[color]}`}>
      <div className="text-[11px] opacity-75">{label}</div>
      <div className="text-base font-semibold">{value}</div>
    </div>
  );
}

function EmptyAnalyticsState({ text }: { text: string }) {
  return <div className="mt-4 rounded-lg border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">{text}</div>;
}
