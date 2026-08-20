import Link from "next/link";

import { PageHeader, PageShell } from "@/components/page-shell";
import { TwoFactorSettings } from "@/components/two-factor-settings";
import { requireSession } from "@/lib/auth/require-session";
import { prisma } from "@/lib/db";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export default async function AccountSecurityPage() {
  const session = await requireSession("/account/security");
  const locale = await getServerLocale();
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { twoFactorEnabled: true },
  });

  return (
    <PageShell maxW="max-w-4xl">
      <PageHeader
        eyebrow={t("accountPasswordPage.eyebrow", locale)}
        title={t("auth.account-security", locale)}
        description={t("auth.account-security-description", locale)}
        className="mb-8"
      />
      <div className="space-y-4">
        <TwoFactorSettings enabled={user?.twoFactorEnabled ?? false} />
        <Link
          href="/account/password"
          className="inline-flex rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent-border)] hover:bg-[var(--accent-bg)] hover:text-[var(--accent)]"
        >
          {t("auth.change-password", locale)}
        </Link>
      </div>
    </PageShell>
  );
}
