import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ButtonLink } from "@/components/action-button";
import { t, getServerLocale } from "@/lib/i18n/translations";
import { PageShell, PageHeader } from "@/components/page-shell";

import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function AccountPasswordPage() {
  const session = await requireSession("/account/password");
  // The shared-account tip points to user management only for someone who can create accounts there.
  const canManageUsers = sessionHasPermission(session, "user:manage");
  const locale = await getServerLocale();

  return (
    <PageShell>
      <PageHeader eyebrow={t("accountPasswordPage.eyebrow", locale)} title={t("accountPasswordPage.title", locale)} description={t("accountPasswordPage.description", locale)} className="mb-8" />

      <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <ChangePasswordForm />

        <aside data-card className="self-start">
          <h2 className="ui-title-section">{t("accountPasswordPage.securityTips", locale)}</h2>
          <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-7 text-[var(--text-secondary)] marker:text-[var(--text-muted)]">
            <li>{t("accountPasswordPage.tip1", locale)}</li>
            <li>{t("accountPasswordPage.tip2", locale)}</li>
            <li>{t("accountPasswordPage.tip3", locale)}</li>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <ButtonLink href="/account/security" variant="secondary" size="sm">
              {t("accountPasswordPage.link.security", locale)}
            </ButtonLink>
            {canManageUsers ? (
              <ButtonLink href="/users" variant="secondary" size="sm">
                {t("accountPasswordPage.link.users", locale)}
              </ButtonLink>
            ) : null}
          </div>
        </aside>
      </section>
    </PageShell>
  );
}
