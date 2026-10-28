import { getServerLocale, t } from "@/lib/i18n/translations";
import { appTimeZoneDateKey, shiftAppTimeZoneDay, startOfDayInAppTimeZone } from "@/lib/datetime/time-zone";
import { formatDateTime } from "@/lib/datetime/format";
import { getPublicStatus } from "@/lib/status/service";
import { createLogger } from "@/lib/logging";
import { getAllUptimeDataInternal, type UptimeDay } from "@/lib/uptime/internal";
import type { SessionPayload } from "@/lib/auth/session";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import type { SystemHealthCheck } from "@/lib/system-health/service";
import {
  calculateWeightedSla,
  calculateWindowCoverage,
  describeUptimeDay,
  expectedMinutesForDay,
  getUptimeColorClass,
} from "./uptime-presentation";

const logger = createLogger("status:page");

type Locale = Parameters<typeof t>[1];

export function healthLabel(status: string, locale: Locale) {
  switch (status) {
    case "healthy":
      return t("statusPage.health.healthy", locale);
    case "warning":
      return t("statusPage.health.warning", locale);
    case "degraded":
      return t("statusPage.health.degraded", locale);
    case "critical":
      return t("statusPage.health.critical", locale);
    default:
      return status;
  }
}

export function healthDotClass(status: string) {
  return status === "healthy" ? "bg-[var(--success)]" : status === "warning" ? "bg-[var(--warning)]" : "bg-[var(--danger)]";
}

/** The translated text, or the service's own wording when no entry exists. */
function translatedOr(key: string, fallback: string, locale: Locale, vars?: Record<string, string | number>) {
  const text = t(key, locale, vars);
  return text === key ? fallback : text;
}

function UptimeHeatmaps({ servers, locale }: { servers: Array<{ id: string; name?: string | null; data?: UptimeDay[] }>; locale: Locale }) {
  return (
    <div className="mt-8">
      <h2 className="ui-title-section">{t("statusPage.uptime.title", locale)}</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{t("statusPage.uptime.desc", locale)}</p>
      {servers.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-secondary)]">{t("statusPage.uptime.empty", locale)}</p>
      ) : (
        <div className="mt-4 grid gap-6">
          {servers.map((server) => {
            const daysMap = new Map<string, UptimeDay>();
            (server.data || []).forEach((d) => {
              if (d.date) daysMap.set(String(d.date), d);
            });
            // Day cells follow the application time zone, like the rollup that fills them.
            const now = new Date();
            const days: string[] = [];
            for (let i = 89; i >= 0; i--) days.push(appTimeZoneDateKey(shiftAppTimeZoneDay(now, -i)));
            const today = days[days.length - 1];
            const minutesToday = (now.getTime() - startOfDayInAppTimeZone(now).getTime()) / 60_000;
            const filled = days.map((date) => {
              const sample = daysMap.get(date);
              const day = {
                uptimePercent: sample?.uptimePercent ?? 0,
                checkCount: sample?.checkCount ?? 0,
                onlineMinutes: sample?.onlineMinutes ?? 0,
                offlineMinutes: sample?.offlineMinutes ?? 0,
              };
              const expectedMinutes = expectedMinutesForDay(date === today ? minutesToday : 1440);
              return { date, ...day, expectedMinutes, ...describeUptimeDay(day, expectedMinutes) };
            });
            const sla = calculateWeightedSla(server.data ?? []);
            const windowCoverage = calculateWindowCoverage(filled);
            return (
              <div key={server.id} data-card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="ui-title-group">{server.name || t("statusPage.uptime.defaultServerName", locale)}</h3>
                  <div className="text-xs text-[var(--text-muted)]">
                    {t("statusPage.uptime.slaLabel", locale)} <span className="font-mono">{sla === null ? "—" : `${sla}%`}</span>
                    {windowCoverage ? (
                      <span className={windowCoverage.sufficient ? undefined : "text-[var(--warning)]"}>
                        {" · "}
                        {t("statusPage.uptime.coverage", locale, { coverage: windowCoverage.coveragePercent })}
                        {windowCoverage.sufficient ? "" : ` · ${t("statusPage.uptime.insufficient", locale)}`}
                      </span>
                    ) : null}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {filled.map((d) => (
                    <div
                      key={d.date}
                      className={`h-4 w-4 rounded ${getUptimeColorClass(d.uptimePercent, d.sampled, d.sufficient)} transition hover:z-10 hover:scale-125`}
                      title={
                        d.sampled
                          ? t("statusPage.uptime.dayTooltip", locale, {
                              date: d.date,
                              percent: d.uptimePercent,
                              checks: d.checkCount,
                              coverage: d.coveragePercent,
                            }) + (d.sufficient ? "" : ` · ${t("statusPage.uptime.insufficient", locale)}`)
                          : `${d.date}: ${t("statusPage.uptime.noSample", locale)}`
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Signed-in part of /status: component checks and the customer-scoped uptime
 * heatmaps. Rendered below the public board, never part of its data.
 */
export async function InternalStatusSection({ session }: { session: SessionPayload }) {
  const locale = await getServerLocale();
  // The component checks count every customer's servers and storage nodes ("N VPS instances enabled"): they are for
  // the platform's administrators. A customer account sees its own uptime below.
  const showPlatformChecks = isGlobalTeamManager(session);
  const [uptimeData, status] = await Promise.all([
    getAllUptimeDataInternal({ session }).catch((err) => {
      logger.error("Failed to fetch uptime data", err);
      return null;
    }),
    showPlatformChecks ? getPublicStatus() : Promise.resolve(null),
  ]);
  if (!status) {
    return (
      <section aria-labelledby="internal-status-title" className="mt-10 border-t border-[var(--border)] pt-6">
        <h2 id="internal-status-title" className="ui-title-section">{t("statusPage.internal.title", locale)}</h2>
        <UptimeHeatmaps servers={uptimeData?.servers ?? []} locale={locale} />
      </section>
    );
  }
  return (
    <section aria-labelledby="internal-status-title" className="mt-10 border-t border-[var(--border)] pt-6">
      <h2 id="internal-status-title" className="ui-title-section">{t("statusPage.internal.title", locale)}</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">{t("statusPage.internal.desc", locale)}</p>
      <div data-card className="mt-4 p-5">
        <div className="flex items-center gap-3">
          <span className={`inline-block h-3 w-3 rounded-full ${healthDotClass(status.summary.overall)}`} />
          <span className="text-lg font-medium text-[var(--text-primary)]">
            {t("statusPage.overallLabel", locale)}
            {healthLabel(status.summary.overall, locale)}
          </span>
        </div>
        <p className="mt-2 text-xs text-[var(--text-muted)]">
          {t("statusPage.updatedAt", locale)}
          {formatDateTime(status.generatedAt, locale)}
        </p>
      </div>
      <div className="mt-4 grid gap-3">
        {status.checks.map((c: SystemHealthCheck) => (
          <div key={c.id} data-card className="p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 rounded-full ${healthDotClass(c.status)}`} />
                <b className="text-sm text-[var(--text-primary)]">{translatedOr(`statusPage.check.${c.id}.label`, c.label, locale)}</b>
              </div>
              <span className={`text-xs ${c.status === "healthy" ? "text-[var(--success)]" : c.status === "warning" ? "text-[var(--warning)]" : "text-[var(--danger)]"}`}>
                {healthLabel(c.status, locale)}
              </span>
            </div>
            <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
              {c.messageCode ? translatedOr(`statusPage.check.${c.id}.${c.messageCode}`, c.message, locale, c.params) : c.message}
            </p>
          </div>
        ))}
      </div>
      <UptimeHeatmaps servers={uptimeData?.servers ?? []} locale={locale} />
    </section>
  );
}
