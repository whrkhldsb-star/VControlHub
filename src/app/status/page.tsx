import { type SystemHealthCheck } from "@/lib/system-health/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { getPublicStatus } from "@/lib/status/service";
import { createLogger } from "@/lib/logging";
import { getAllUptimeDataInternal } from "@/lib/uptime/internal";

const logger = createLogger("status:page");

export const dynamic = "force-dynamic";
export const revalidate = 0;

type StatusCheck = SystemHealthCheck;

type UptimeDay = {
  date: string;
  uptimePercent: number;
};

type UptimeServer = {
  id: string;
  name?: string | null;
  data?: UptimeDay[];
};

type UptimeResponse = {
  servers?: UptimeServer[];
};

async function getAllUptimeData(): Promise<UptimeResponse | null> {
  try {
    return await getAllUptimeDataInternal();
  } catch (err) {
    logger.error("Failed to fetch uptime data", err);
  }
  return null;
}

function getColorClass(uptime: number) {
  if (uptime === 0) return "bg-[var(--surface-hover)]";
  if (uptime >= 99) return "bg-[var(--success)]";
  if (uptime >= 95) return "bg-[var(--info)]";
  if (uptime >= 90) return "bg-[var(--warning)]";
  if (uptime >= 75) return "bg-[var(--warning)]";
  return "bg-[var(--danger)]";
}

function getHealthLabel(status: string, locale: Parameters<typeof t>[1]) {
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

export default async function Page() {
  const status = await getPublicStatus();
  const locale = await getServerLocale();
  const dateLocale = toDateLocale(locale);
  const uptimeData = await getAllUptimeData();

  return (
    <main className="min-h-screen bg-[var(--surface)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-5xl px-6 py-14">
        <h1 className="text-3xl font-semibold">{t("statusPage.title", locale)}</h1>
        <p className="mt-2 text-sm text-[var(--text-secondary)]">
          {t("statusPage.desc", locale)}
        </p>

        <div data-card className="mt-6">
          <div className="flex items-center gap-3">
            <span
              className={`inline-block h-3 w-3 rounded-full ${
                status.summary.overall === "healthy"
                  ? "bg-[var(--success)]"
                  : status.summary.overall === "warning"
                  ? "bg-[var(--warning)]"
                  : "bg-[var(--danger)]"
              }`}
            />
            <span className="text-lg font-medium">
              {t("statusPage.overallLabel", locale)}
              {getHealthLabel(status.summary.overall, locale)}
            </span>
          </div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">
            {t("statusPage.updatedAt", locale)}
            {new Date(status.generatedAt).toLocaleString(dateLocale)}
          </p>
        </div>

        <div className="mt-4 grid gap-3">
          {status.checks.map((c: StatusCheck) => (
            <div key={c.id} data-card className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2 w-2 rounded-full ${
                      c.status === "healthy"
                        ? "bg-[var(--success)]"
                        : c.status === "warning"
                        ? "bg-[var(--warning)]"
                        : "bg-[var(--danger)]"
                    }`}
                  />
                  <b className="text-sm text-[var(--text-primary)]">{c.label}</b>
                </div>
                <span
                  className={`text-xs ${
                    c.status === "healthy"
                      ? "text-[var(--success)]"
                      : c.status === "warning"
                      ? "text-[var(--warning)]"
                      : "text-[var(--danger)]"
                  }`}
                >
                  {getHealthLabel(c.status, locale)}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
                {c.message}
              </p>
            </div>
          ))}
        </div>

        {uptimeData && uptimeData.servers && uptimeData.servers.length > 0 && (
          <div className="mt-8">
            <h2 className="text-lg font-medium">{t("statusPage.uptime.title", locale)}</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              {t("statusPage.uptime.desc", locale)}
            </p>
            <div className="mt-4 grid gap-6">
              {uptimeData.servers.map((server: UptimeServer) => {
                const daysMap = new Map<string, number>();
                (server.data || []).forEach((d: UptimeDay) => {
                  const dateKey = d.date ? String(d.date) : "";
                  if (dateKey) daysMap.set(dateKey, d.uptimePercent ?? 0);
                });

                const today = new Date();
                today.setUTCHours(0, 0, 0, 0);
                const days = [];
                for (let i = 89; i >= 0; i--) {
                  const d = new Date(today);
                  d.setUTCDate(d.getUTCDate() - i);
                  const dateStr = d.toISOString().split("T")[0];
                  days.push(dateStr);
                }

                const filled = days
                  .filter((dateStr): dateStr is string => !!dateStr)
                  .map((dateStr) => ({
                    date: dateStr,
                    uptimePercent: daysMap.get(dateStr) ?? 0,
                  }));

                const sla = filled.length > 0
                  ? Math.round((filled.reduce((sum, d) => sum + d.uptimePercent, 0) / filled.length) * 100) / 100
                  : 0;

                return (
                  <div key={server.id} data-card className="p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-sm font-medium">{server.name || t("statusPage.uptime.defaultServerName", locale)}</h3>
                      <div className="text-xs text-[var(--text-muted)]">
                        {t("statusPage.uptime.slaLabel", locale)} <span className="font-mono">{sla}%</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {filled.map((d, _idx) => (
                        <div
                          key={d.date}
                          className={`h-4 w-4 rounded ${getColorClass(d.uptimePercent)} transition hover:scale-125 hover:z-10`}
                          title={`${d.date}: ${d.uptimePercent}%`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <p className="mt-8 text-center text-xs text-[var(--text-muted)]">
          VControlHub · {new Date().getFullYear()}
        </p>
      </div>
    </main>
  );
}
