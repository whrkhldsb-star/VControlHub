import { requireSession } from "@/lib/auth/require-session";
import { t } from "@/lib/i18n/translations";

import { ChangePasswordForm } from "./change-password-form";

export const dynamic = "force-dynamic";

export default async function AccountPasswordPage() {
  await requireSession("/account/password");

  return (
    <main className="min-h-screen bg-slate-950 text-[var(--text-primary)]">
      <div className="mx-auto max-w-4xl px-6 py-10 lg:px-10">
 <header className="mb-8">
 <h1 className="text-3xl font-semibold tracking-tight">{t("accountPasswordPage.title")}</h1>
 <p className="mt-2 text-sm text-[var(--text-secondary)]">{t("accountPasswordPage.description")}</p>
 </header>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <ChangePasswordForm />

          <aside className="rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6">
            <h2 className="text-xl font-semibold text-[var(--text-primary)]">{t("accountPasswordPage.securityTips")}</h2>
            <ul className="mt-4 space-y-3 text-sm leading-7 text-[var(--text-secondary)]">
              <li>{t("accountPasswordPage.tip1")}</li>
              <li>{t("accountPasswordPage.tip2")}</li>
              <li>{t("accountPasswordPage.tip3")}</li>
            </ul>
          </aside>
        </section>
      </div>
    </main>
  );
}
