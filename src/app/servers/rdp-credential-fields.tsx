"use client";

import { CheckboxField } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

const LABEL = "text-xs font-medium text-[var(--text-primary)]/70";

/** Same sectioned layout the Linux-only blocks use, so the Windows form does not read as a bolt-on. */
export function RdpCredentialFields({ idPrefix, editing = false, domain = "", certificateSha256 = "", ignoreCertificate = false }: {
  idPrefix: string; editing?: boolean; domain?: string; ignoreCertificate?: boolean; certificateSha256?: string;
}) {
  const { t } = useI18n();
  return <section className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] p-4">
    <div className="space-y-1">
      <h3 className="text-sm font-medium text-[var(--text-primary)]">{t("serversPage.windows.credentialsTitle")}</h3>
      <p className="text-xs leading-5 text-[var(--text-muted)]">{t("serversPage.windows.hint")}</p>
    </div>
    {!editing && <div className="space-y-1.5">
      <label htmlFor={`${idPrefix}-username`} className={LABEL}>{t("serversPage.windows.username")}</label>
      <input id={`${idPrefix}-username`} name="username" defaultValue="Administrator" required maxLength={128} className={UI_INPUT} autoComplete="off" />
    </div>}
    <div className="space-y-1.5">
      <label htmlFor={`${idPrefix}-password`} className={LABEL}>{t(editing ? "serversPage.windows.passwordKeep" : "serversPage.windows.password")}</label>
      <input id={`${idPrefix}-password`} name="rdpPassword" type="password" required={!editing} maxLength={1024} autoComplete="new-password" className={UI_INPUT} />
    </div>
    <div className="space-y-1.5">
      <label htmlFor={`${idPrefix}-domain`} className={LABEL}>{t("serversPage.windows.domain")}</label>
      <input id={`${idPrefix}-domain`} name="rdpDomain" defaultValue={domain} maxLength={128} className={UI_INPUT} />
    </div>
    <div className="space-y-1.5">
      <label htmlFor={`${idPrefix}-certificate`} className={LABEL}>{t("serversPage.windows.certificate")}</label>
      <input id={`${idPrefix}-certificate`} name="rdpCertificateSha256" defaultValue={certificateSha256} maxLength={95} pattern="([a-fA-F0-9]{64}|([a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2})" className={UI_INPUT} aria-describedby={`${idPrefix}-certificate-help`} />
      <p id={`${idPrefix}-certificate-help`} className="text-xs leading-5 text-[var(--text-muted)]">{t("serversPage.windows.certificateHelp")}</p>
    </div>
    <CheckboxField label={t("serversPage.windows.ignoreCertificate")} name="rdpIgnoreCertificate" defaultChecked={ignoreCertificate} className="pt-1" />
  </section>;
}
