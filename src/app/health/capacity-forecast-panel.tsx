"use client";

/**
 * CapacityForecastPanel — fleet capacity prediction surface on /health.
 * Loads GET /api/health/capacity and renders risk summary + per-node table.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { tt as applyTemplate } from "./health-dashboard-helpers";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { StatusBadge, type StatusTone } from "@/components/status-badge";
import { Notice } from "@/components/ui-primitives";
import { UI_INPUT } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";

type CapacityRisk = "ok" | "watch" | "warning" | "critical" | "insufficient_data";

type MetricForecast = {
  metric: "cpu" | "mem" | "disk";
  sampleCount: number;
  latest: number | null;
  slopePerDay: number | null;
  projected: number | null;
  horizonDays: number;
  daysUntil85: number | null;
  daysUntil95: number | null;
  risk: CapacityRisk;
  reason: string;
};

type ServerForecast = {
  serverId: string;
  serverName: string;
  host: string | null;
  overallRisk: CapacityRisk;
  metrics: MetricForecast[];
  sampleCount: number;
  latestSampleAt: string | null;
};

type CapacityPayload = {
  summary: {
    serverCount: number;
    forecastable: number;
    insufficientData: number;
    byRisk: Record<CapacityRisk, number>;
    worstRisk: CapacityRisk;
    horizonDays: number;
    windowHours: number;
    generatedAt: string;
  };
  servers: ServerForecast[];
};

/** Risk colours the figure, never the tile (docs/ui-system.md: cards stay neutral). */
const RISK_TEXT: Record<CapacityRisk, string> = {
  ok: "text-[var(--success)]",
  watch: "text-[var(--text-secondary)]",
  warning: "text-[var(--warning)]",
  critical: "text-[var(--danger)]",
  insufficient_data: "text-[var(--text-muted)]",
};

const RISK_BADGE_TONE: Record<CapacityRisk, StatusTone> = {
  ok: "success",
  watch: "neutral",
  warning: "warning",
  critical: "danger",
  insufficient_data: "neutral",
};

function formatDays(value: number | null, t: (k: string, vars?: Record<string, string | number>) => string): string {
  if (value === null) return t("healthPage.capacity.na");
  if (value === 0) return t("healthPage.capacity.now");
  if (value < 1) return t("healthPage.capacity.ltOneDay");
  if (value >= 3650) return t("healthPage.capacity.far");
  return applyTemplate(t, "healthPage.capacity.days", { n: Math.round(value * 10) / 10 });
}

function metricLabel(metric: MetricForecast["metric"], t: (k: string, vars?: Record<string, string | number>) => string): string {
  if (metric === "cpu") return t("healthPage.capacity.metric.cpu");
  if (metric === "mem") return t("healthPage.capacity.metric.mem");
  return t("healthPage.capacity.metric.disk");
}

function riskLabel(risk: CapacityRisk, t: (k: string, vars?: Record<string, string | number>) => string): string {
  return t(`healthPage.capacity.risk.${risk}`);
}

/** Usage cannot exceed 100 %: a trend that extrapolates past it means "full". */
export function formatProjectedPercent(value: number): string {
  return value >= 100 ? "≥100%" : `${value.toFixed(1)}%`;
}

export function CapacityForecastPanel() {
  const { t } = useI18n();
  const [data, setData] = useState<CapacityPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [horizonDays, setHorizonDays] = useState(14);
  const loadGenRef = useRef(0);

  const load = useCallback(async (horizon: number) => {
    const gen = ++loadGenRef.current;
    setLoading(true);
    setError(null);
    try {
      const payload = (await csrfFetch(
        `/api/health/capacity?horizonDays=${horizon}&windowHours=168`,
      )) as CapacityPayload;
      // Ignore stale responses when horizon/refresh races complete out of order.
      if (gen !== loadGenRef.current) return;
      setData(payload);
    } catch (err) {
      if (gen !== loadGenRef.current) return;
      setError(getErrorMessage(err, t("healthPage.capacity.error")));
      setData(null);
    } finally {
      if (gen === loadGenRef.current) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load(horizonDays);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load, horizonDays]);

  return (
    <section
      data-card className="space-y-4 p-4"
      aria-label={t("healthPage.capacity.title")}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs text-[var(--text-muted)]">
            {t("healthPage.capacity.eyebrow")}
          </p>
          <h2 className="ui-title-section mt-1">
            {t("healthPage.capacity.title")}
          </h2>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">
            {t("healthPage.capacity.description")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 whitespace-nowrap text-xs text-[var(--text-secondary)]">
            <span>{t("healthPage.capacity.horizon")}</span>
            <select
              className={cn(UI_INPUT, "w-auto text-xs")}
              value={horizonDays}
              onChange={(e) => setHorizonDays(Number(e.target.value))}
              aria-label={t("healthPage.capacity.horizon")}
            >
              <option value={7}>7d</option>
              <option value={14}>14d</option>
              <option value={30}>30d</option>
            </select>
          </label>
          <ActionButton size="sm" variant="secondary"
            onClick={() => void load(horizonDays)}
            disabled={loading}>
            {loading ? t("healthPage.capacity.refreshing") : t("healthPage.capacity.refresh")}
          </ActionButton>
        </div>
      </div>

      {error ? (
        <Notice tone="danger">
          {error}
        </Notice>
      ) : null}

      {loading && !data ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              data-tile className="h-20 animate-pulse"
            />
          ))}
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <article data-tile className="p-3">
              <p className="text-xs text-[var(--text-muted)]">
                {t("healthPage.capacity.summary.nodes")}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
                {data.summary.serverCount}
              </p>
            </article>
            <article data-tile className="p-3">
              <p className="text-xs text-[var(--text-muted)]">
                {t("healthPage.capacity.summary.forecastable")}
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
                {data.summary.forecastable}
              </p>
            </article>
            <article data-tile className="p-3">
              <p className="text-xs text-[var(--text-muted)]">
                {t("healthPage.capacity.risk.critical")}
              </p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${data.summary.byRisk.critical > 0 ? RISK_TEXT.critical : "text-[var(--text-primary)]"}`}>
                {data.summary.byRisk.critical}
              </p>
            </article>
            <article data-tile className="p-3">
              <p className="text-xs text-[var(--text-muted)]">
                {t("healthPage.capacity.risk.warning")}
              </p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${data.summary.byRisk.warning > 0 ? RISK_TEXT.warning : "text-[var(--text-primary)]"}`}>
                {data.summary.byRisk.warning}
              </p>
            </article>
            <article data-tile className="p-3">
              <p className="text-xs text-[var(--text-muted)]">
                {t("healthPage.capacity.summary.worst")}
              </p>
              <p className={`mt-1 text-lg font-semibold ${RISK_TEXT[data.summary.worstRisk]}`}>
                {riskLabel(data.summary.worstRisk, t)}
              </p>
            </article>
          </div>

          <p className="text-xs text-[var(--text-muted)]">
            {applyTemplate(t, "healthPage.capacity.meta", {
              windowHours: data.summary.windowHours,
              horizonDays: data.summary.horizonDays,
              insufficient: data.summary.insufficientData,
            })}
          </p>

          {data.servers.length === 0 ? (
            <p className="text-sm text-[var(--text-secondary)]">
              {t("healthPage.capacity.empty")}
            </p>
          ) : (
            <div role="region" aria-label={t("healthPage.capacity.summary.nodes")} tabIndex={0} className="overflow-x-auto rounded-lg border border-[var(--border)]">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-[var(--surface-elevated)] text-xs uppercase text-[var(--text-muted)]">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("healthPage.capacity.col.node")}</th>
                    <th className="px-3 py-2 font-medium">{t("healthPage.capacity.col.risk")}</th>
                    <th className="px-3 py-2 font-medium">{t("healthPage.capacity.col.metric")}</th>
                    <th className="px-3 py-2 font-medium">{t("healthPage.capacity.col.latest")}</th>
                    <th className="px-3 py-2 font-medium">{t("healthPage.capacity.col.slope")}</th>
                    <th className="px-3 py-2 font-medium">{t("healthPage.capacity.col.projected")}</th>
                    <th className="px-3 py-2 font-medium">{t("healthPage.capacity.col.until85")}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.servers.map((server) => {
                    const rows = server.metrics;
                    return rows.map((metric, idx) => (
                      <tr
                        key={`${server.serverId}-${metric.metric}`}
                        className="border-t border-[var(--border)]"
                      >
                        {idx === 0 ? (
                          <td
                            className="px-3 py-2 align-top font-medium text-[var(--text-primary)]"
                            rowSpan={rows.length}
                          >
                            <div>{server.serverName}</div>
                            {server.host ? (
                              <div className="text-xs font-normal text-[var(--text-muted)]">
                                {server.host}
                              </div>
                            ) : null}
                          </td>
                        ) : null}
                        {idx === 0 ? (
                          <td className="px-3 py-2 align-top" rowSpan={rows.length}>
                            <StatusBadge tone={RISK_BADGE_TONE[server.overallRisk]}>
                              {riskLabel(server.overallRisk, t)}
                            </StatusBadge>
                          </td>
                        ) : null}
                        <td className="px-3 py-2 text-[var(--text-secondary)]">
                          {metricLabel(metric.metric, t)}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[var(--text-primary)]">
                          {metric.latest === null ? "—" : `${metric.latest.toFixed(1)}%`}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[var(--text-secondary)]">
                          {metric.slopePerDay === null
                            ? "—"
                            : `${metric.slopePerDay > 0 ? "+" : ""}${metric.slopePerDay.toFixed(2)}%/d`}
                        </td>
                        <td className="px-3 py-2 font-mono tabular-nums text-[var(--text-primary)]">
                          {metric.projected === null ? "—" : formatProjectedPercent(metric.projected)}
                        </td>
                        <td className="px-3 py-2 text-[var(--text-secondary)]">
                          {formatDays(metric.daysUntil85, t)}
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
