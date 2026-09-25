import { requireSession } from "@/lib/auth/require-session";
import { t, getServerLocale } from "@/lib/i18n/translations";
import { PageShell, PageHeader } from "@/components/page-shell";

import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function AccountPasswordPage() {
  await requireSession("/account/password");
  const locale = await getServerLocale();

  return (
    <PageShell>
      <PageHeader eyebrow={t("accountPasswordPage.eyebrow", locale)} title={t("accountPasswordPage.title", locale)} description={t("accountPasswordPage.description", locale)} className="mb-8" />

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <ChangePasswordForm />

        <aside data-card className="self-start">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">{t("accountPasswordPage.securityTips", locale)}</h2>
          <ul className="mt-4 space-y-3 text-sm leading-7 text-[var(--text-secondary)]">
            <li>{t("accountPasswordPage.tip1", locale)}</li>
            <li>{t("accountPasswordPage.tip2", locale)}</li>
            <li>{t("accountPasswordPage.tip3", locale)}</li>
          </ul>
        </aside>
      </section>
    </PageShell>
  );
}
