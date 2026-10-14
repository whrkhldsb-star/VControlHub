import { PageHeader, PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/action-button";
import { getCurrentSession } from "@/lib/auth/server-session";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { formatDateTime } from "@/lib/datetime/format";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { createLogger } from "@/lib/logging";
import { parseBoardQuery } from "@/lib/public-status/query";
import { readPublicBoard } from "@/lib/public-status/read";
import { getPublicStatusSummary } from "@/lib/status/service";
import { InternalStatusSection, healthDotClass, healthLabel } from "./internal-status-section";
import { PublicBoardClient } from "./public-board-client";

const logger = createLogger("status:page");

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * /status
 * - Board open (or a platform administrator previewing with ?preview=1): the
 *   public node board, built by the same projection as /api/status/board.
 * - Board closed: the overall platform status only, as before.
 * - Signed-in accounts additionally see the internal component checks and
 *   their customer's uptime below (not in guest preview).
 */
export default async function Page({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const [session, locale, params] = await Promise.all([getCurrentSession(), getServerLocale(), searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>)]);
  const isAdmin = Boolean(session && isGlobalTeamManager(session));
  const preview = params.preview === "1" && isAdmin;
  const board = await readPublicBoard(parseBoardQuery(params), { preview }).catch((error) => {
    logger.error("Failed to load the public board", error);
    return null;
  });

  return (
    <PageShell navigation={Boolean(session)}>
      {board ? (
        <PublicBoardClient initial={board} preview={preview} signedIn={Boolean(session)} />
      ) : (
        <ClosedBoard signedIn={Boolean(session)} isAdmin={isAdmin} locale={locale} />
      )}
      {session && !preview ? <InternalStatusSection session={session} /> : null}
    </PageShell>
  );
}

async function ClosedBoard({ signedIn, isAdmin, locale }: { signedIn: boolean; isAdmin: boolean; locale: Awaited<ReturnType<typeof getServerLocale>> }) {
  const status = await getPublicStatusSummary();
  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader eyebrow={t("statusPage.eyebrow", locale)} title={t("statusPage.title", locale)} description={t("statusPage.desc", locale)}>
        {isAdmin ? (
          <ButtonLink href="/public-status" variant="outline" size="sm">{t("statusPage.manageBoard", locale)}</ButtonLink>
        ) : !signedIn ? (
          <ButtonLink href="/login?next=%2F" variant="primary" size="sm">{t("statusPage.signIn", locale)}</ButtonLink>
        ) : null}
      </PageHeader>
      <div data-card className="mt-6 p-5">
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
      {!signedIn ? <p className="mt-6 text-sm leading-6 text-[var(--text-secondary)]">{t("statusPage.public.detailsHint", locale)}</p> : null}
    </div>
  );
}
