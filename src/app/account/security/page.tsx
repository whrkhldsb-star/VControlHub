
import { PageHeader, PageShell } from "@/components/page-shell";
import { TwoFactorSettings } from "@/components/two-factor-settings";
import { requireSession } from "@/lib/auth/require-session";
import { prisma } from "@/lib/db";
import { getServerLocale, t } from "@/lib/i18n/translations";

import { SignOutAllDevices } from "./sign-out-all-devices";

import { ButtonLink } from "@/components/action-button";
export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const session = await requireSession("/account/security");
  const locale = await getServerLocale();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { twoFactorEnabled: true },
  });

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("accountPasswordPage.eyebrow", locale)}
        title={t("auth.account-security", locale)}
        description={t("auth.account-security-description", locale)}
        className="mb-8"
      />
      <div className="flex max-w-3xl flex-col gap-4">
        {/* The password is one of the account's security settings: a row like the others, not a loose button. */}
        <div data-inset className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="ui-title-group">{t("auth.change-password", locale)}</h3>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">{t("accountPasswordPage.description", locale)}</p>
            </div>
            <ButtonLink href="/account/password" variant="secondary" className="shrink-0">
              {t("auth.change-password", locale)}
            </ButtonLink>
          </div>
        </div>
        <TwoFactorSettings enabled={user?.twoFactorEnabled ?? false} />
        <SignOutAllDevices />
      </div>
    </PageShell>
  );
}
