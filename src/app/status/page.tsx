import { PageHeader, PageShell } from "@/components/page-shell";
import { ButtonLink } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
import { getCurrentSession } from "@/lib/auth/server-session";
import { canPreviewClosedBoard, canReadInternalStatus } from "@/lib/public-status/access";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { formatDateTime } from "@/lib/datetime/format";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { createLogger } from "@/lib/logging";
import { parseBoardQuery } from "@/lib/public-status/query";
import { readPublicBoard } from "@/lib/public-status/read";
import { getPublicStatusSummary } from "@/lib/public-status/platform";
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
  const [rawSession, locale, params] = await Promise.all([getCurrentSession(), getServerLocale(), searchParams ?? Promise.resolve({} as Record<string, string | string[] | undefined>)]);
  const session = rawSession?.mustChangePassword ? null : rawSession;
  const isAdmin = Boolean(session && isGlobalTeamManager(session));
  const preview = params.preview === "1" && canPreviewClosedBoard(session);
  // A board that could not be read is not a closed board: the page says which.
  const read = await readPublicBoard(parseBoardQuery(params), { preview }).then(
    (board) => ({ board, failed: false }),
    (error: unknown) => {
      logger.error("Failed to load the public board", error);
      return { board: null, failed: true };
    },
  );
  const { board, failed: boardFailed } = read;

  return (
    <PageShell navigation={Boolean(session)}>
      {board ? (
        <PublicBoardClient initial={board} preview={preview} signedIn={Boolean(session)} canManageBoard={isAdmin && !preview} />
      ) : (
        <ClosedBoard signedIn={Boolean(session)} isAdmin={isAdmin} locale={locale} loadFailed={boardFailed} />
      )}
      {canReadInternalStatus(session) && !preview ? <InternalStatusSection session={session} /> : null}
    </PageShell>
  );
}

async function ClosedBoard({ signedIn, isAdmin, locale, loadFailed = false }: { signedIn: boolean; isAdmin: boolean; locale: Awaited<ReturnType<typeof getServerLocale>>; loadFailed?: boolean }) {
  const status = await getPublicStatusSummary();
  return (
    // Visitors get a centred reading column; inside the console it lines up with the sections below.
    <div className={signedIn ? "w-full" : "mx-auto w-full max-w-3xl"}>
      <PageHeader eyebrow={t("statusPage.eyebrow", locale)} title={t("statusPage.title", locale)} description={t("statusPage.desc", locale)}>
        {isAdmin ? (
          <ButtonLink href="/public-status" variant="outline" size="sm">{t("statusPage.manageBoard", locale)}</ButtonLink>
        ) : !signedIn ? (
          <ButtonLink href="/login?next=%2F" variant="primary" size="sm">{t("statusPage.signIn", locale)}</ButtonLink>
        ) : null}
      </PageHeader>
      {loadFailed ? (
        <Notice tone="warning" title={t("statusPage.boardUnavailable.title", locale)} className="mb-4">
          {t("statusPage.boardUnavailable.body", locale)}
        </Notice>
      ) : null}
      <div data-card className="p-5">
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
      {!signedIn && !loadFailed ? <p className="mt-6 text-sm leading-6 text-[var(--text-secondary)]">{t("statusPage.public.detailsHint", locale)}</p> : null}
    </div>
  );
}
