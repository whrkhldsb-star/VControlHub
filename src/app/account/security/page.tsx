
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
      <div className="max-w-3xl space-y-4">
        <TwoFactorSettings enabled={user?.twoFactorEnabled ?? false} />
        <SignOutAllDevices />
        <ButtonLink href="/account/password" variant="secondary">
          {t("auth.change-password", locale)}
        </ButtonLink>
      </div>
    </PageShell>
  );
}
