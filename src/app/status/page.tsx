import { type SystemHealthCheck } from "@/lib/system-health/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { getPublicStatus, getPublicStatusSummary } from "@/lib/status/service";
import { createLogger } from "@/lib/logging";
import { getAllUptimeDataInternal } from "@/lib/uptime/internal";
import { getCurrentSession } from "@/lib/auth/server-session";

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

async function getAllUptimeData(session: Awaited<ReturnType<typeof getCurrentSession>>): Promise<UptimeResponse | null> {
  try {
    // Authenticated: team-scoped. Anonymous public page: fleet display names only
    // (product status page; no host/port/credentials).
    return await getAllUptimeDataInternal(session ? { session } : {});
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
  if (uptime >= 75) return "bg-[var(--danger)]/50";
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

function renderUptimeSection(
  uptimeData: UptimeResponse | null,
  locale: Parameters<typeof t>[1],
) {
  const servers = uptimeData?.servers ?? [];
  return (
    <div className="mt-8">
      <h2 className="text-lg font-medium">{t("statusPage.uptime.title", locale)}</h2>
      <p className="mt-1 text-xs text-[var(--text-muted)]">
        {t("statusPage.uptime.desc", locale)}
      </p>
      {servers.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--text-secondary)]">
          {t("statusPage.uptime.empty", locale)}
        </p>
      ) : (
        <div className="mt-4 grid gap-6">
          {servers.map((server: UptimeServer) => {
            const daysMap = new Map<string, number>();
            (server.data || []).forEach((d: UptimeDay) => {
              const dateKey = d.date ? String(d.date) : "";
              if (dateKey) daysMap.set(dateKey, d.uptimePercent ?? 0);
            });

            const today = new Date();
            today.setUTCHours(0, 0, 0, 0);
            const days: string[] = [];
            for (let i = 89; i >= 0; i--) {
              const d = new Date(today);
              d.setUTCDate(d.getUTCDate() - i);
              const dateStr = d.toISOString().split("T")[0];
              if (dateStr) days.push(dateStr);
            }

            const filled = days.map((dateStr) => ({
              date: dateStr,
              uptimePercent: daysMap.get(dateStr) ?? 0,
            }));

            // SLA over days that actually have samples (avoid averaging empty zeros).
            const sampled = filled.filter((d) => (daysMap.get(d.date) ?? null) !== null && daysMap.has(d.date));
            const sla =
              sampled.length > 0
                ? Math.round(
                    (sampled.reduce((sum, d) => sum + d.uptimePercent, 0) / sampled.length) * 100,
                  ) / 100
                : 0;

            return (
              <div key={server.id} data-card className="p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-medium">
                    {server.name || t("statusPage.uptime.defaultServerName", locale)}
                  </h3>
                  <div className="text-xs text-[var(--text-muted)]">
                    {t("statusPage.uptime.slaLabel", locale)}{" "}
                    <span className="font-mono">{sampled.length > 0 ? `${sla}%` : "—"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {filled.map((d) => (
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
      )}
    </div>
  );
}

export default async function Page() {
  // Public status page:
  // - anonymous: overall summary + public uptime heatmap (display names only)
  // - authenticated: full component checks + uptime
  const session = await getCurrentSession();
  const locale = await getServerLocale();
  const dateLocale = toDateLocale(locale);
  const uptimeData = await getAllUptimeData(session);

  if (!session) {
    const status = await getPublicStatusSummary();
    return (
      <main className="relative min-h-screen overflow-hidden text-[var(--text-primary)]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--accent)_12%,transparent),transparent_55%),var(--page-bg)]"
        />
        <div className="relative mx-auto max-w-5xl px-6 py-14">
          <header className="mb-8 border-b border-[var(--border-subtle)] pb-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">{t("statusPage.eyebrow", locale)}</p>
            <h1 className="mt-2 break-words text-[1.75rem] font-semibold leading-snug tracking-[-0.02em] text-[var(--text-primary)] sm:text-[2rem]">
              {t("statusPage.title", locale)}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
              {t("statusPage.desc", locale)}
            </p>
          </header>

          <div data-card className="mt-6 p-5">
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
              <span className="text-lg font-medium text-[var(--text-primary)]">
                {t("statusPage.overallLabel", locale)}
                {getHealthLabel(status.summary.overall, locale)}
              </span>
            </div>
            <p className="mt-2 text-xs text-[var(--text-muted)]">
              {t("statusPage.updatedAt", locale)}
              {new Date(status.generatedAt).toLocaleString(dateLocale)}
            </p>
          </div>

          <p className="mt-6 text-sm leading-6 text-[var(--text-secondary)]">
            {t("statusPage.public.detailsHint", locale)}
          </p>

          {renderUptimeSection(uptimeData, locale)}

          <p className="mt-8 text-center text-xs text-[var(--text-muted)]">
            VControlHub · {new Date().getFullYear()}
          </p>
        </div>
      </main>
    );
  }

  const status = await getPublicStatus();

  return (
    <main className="relative min-h-screen overflow-hidden text-[var(--text-primary)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,color-mix(in_srgb,var(--accent)_12%,transparent),transparent_55%),var(--page-bg)]"
      />
      <div className="relative mx-auto max-w-5xl px-6 py-14">
        <header className="mb-8 border-b border-[var(--border-subtle)] pb-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent)]">{t("statusPage.eyebrow", locale)}</p>
          <h1 className="mt-2 break-words text-[1.75rem] font-semibold leading-snug tracking-[-0.02em] text-[var(--text-primary)] sm:text-[2rem]">
            {t("statusPage.title", locale)}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--text-muted)]">
            {t("statusPage.desc", locale)}
          </p>
        </header>

        <div data-card className="mt-6 p-5">
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
            <span className="text-lg font-medium text-[var(--text-primary)]">
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
              <p className="mt-1.5 text-sm text-[var(--text-secondary)]">{c.message}</p>
            </div>
          ))}
        </div>

        {renderUptimeSection(uptimeData, locale)}

        <p className="mt-8 text-center text-xs text-[var(--text-muted)]">
          VControlHub · {new Date().getFullYear()}
        </p>
      </div>
    </main>
  );
}
