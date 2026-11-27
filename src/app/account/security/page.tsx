
import { PageHeader, PageShell } from "@/components/page-shell";
import { TwoFactorSettings } from "@/components/two-factor-settings";
import { requireSession } from "@/lib/auth/require-session";
import { prisma } from "@/lib/db";
import { getServerLocale, t } from "@/lib/i18n/translations";

import { SignOutAllDevices } from "./sign-out-all-devices";

import { ButtonLink } from "@/components/action-button";
export const dynamic = "force-dynamic";

/** The password page comes back here once the new password is saved. */
const CHANGE_PASSWORD_HREF = `/account/password?next=${encodeURIComponent("/account/security")}`;

export default async function AccountSecurityPage() {
  const session = await requireSession("/account/security");
  const locale = await getServerLocale();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    // The secret only to tell a real second factor from a bare flag; it stays here.
    select: { twoFactorEnabled: true, twoFactorSecret: true },
  });

  const twoFactorEnabled = Boolean(user?.twoFactorEnabled && user.twoFactorSecret);

  return (
    <PageShell width="narrow">
      <PageHeader
        eyebrow={t("accountPasswordPage.eyebrow", locale)}
        title={t("auth.account-security", locale)}
        description={t("auth.account-security-description", locale)}
        className="mb-8"
      />
      <div className="flex flex-col gap-4">
        {/* The password is one of the account's security settings: a row like the others, not a loose button. */}
        <div data-inset className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="ui-title-group">{t("auth.change-password", locale)}</h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("accountPasswordPage.description", locale)}</p>
            </div>
            <ButtonLink href={CHANGE_PASSWORD_HREF} variant="secondary" className="shrink-0">
              {t("auth.change-password", locale)}
            </ButtonLink>
          </div>
        </div>
        {/*
          * The two-factor card, with what to have ready before its setup asks for a code inside it: the
          * sentence stood alone between two cards. The settings draw their own well; inside this one they
          * sit flush, so that the card and its note read as one.
          */}
        <div data-inset className="p-5 [&>[data-inset]]:border-0 [&>[data-inset]]:bg-transparent [&>[data-inset]]:p-0">
          <TwoFactorSettings enabled={twoFactorEnabled} />
          {twoFactorEnabled ? null : (
            <p className="mt-4 border-t border-[var(--border-subtle)] pt-3 text-xs leading-5 text-[var(--text-muted)]">
              {t("auth.2fa-prerequisite", locale)}
            </p>
          )}
        </div>
        <SignOutAllDevices />
      </div>
    </PageShell>
  );
}
