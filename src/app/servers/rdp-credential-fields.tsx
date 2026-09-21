"use client";
import { CheckboxField } from "@/components/ui-primitives";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";

const LABEL = "text-xs font-medium text-[var(--text-primary)]/70";

export function RdpCredentialFields({ idPrefix, editing = false, domain = "", certificateSha256 = "", ignoreCertificate = false }: {
  idPrefix: string; editing?: boolean; domain?: string; ignoreCertificate?: boolean; certificateSha256?: string;
}) {
  const { t } = useI18n();
  return <div className="grid gap-3">
    <p className="text-xs leading-5 text-[var(--text-muted)]">{t("serversPage.windows.hint")}</p>
    {!editing && <><label htmlFor={`${idPrefix}-username`} className={LABEL}>{t("serversPage.windows.username")}</label>
      <input id={`${idPrefix}-username`} name="username" defaultValue="Administrator" required maxLength={128} className={UI_INPUT} autoComplete="off" /></>}
    <label htmlFor={`${idPrefix}-password`} className={LABEL}>{t(editing ? "serversPage.windows.passwordKeep" : "serversPage.windows.password")}</label>
    <input id={`${idPrefix}-password`} name="rdpPassword" type="password" required={!editing} maxLength={1024} autoComplete="new-password" className={UI_INPUT} />
    <label htmlFor={`${idPrefix}-domain`} className={LABEL}>{t("serversPage.windows.domain")}</label>
    <input id={`${idPrefix}-domain`} name="rdpDomain" defaultValue={domain} maxLength={128} className={UI_INPUT} />
    <label htmlFor={`${idPrefix}-certificate`} className={LABEL}>{t("serversPage.windows.certificate")}</label>
    <input id={`${idPrefix}-certificate`} name="rdpCertificateSha256" defaultValue={certificateSha256} maxLength={95} pattern="([a-fA-F0-9]{64}|([a-fA-F0-9]{2}:){31}[a-fA-F0-9]{2})" className={UI_INPUT} aria-describedby={`${idPrefix}-certificate-help`} />
    <p id={`${idPrefix}-certificate-help`} className="text-xs leading-5 text-[var(--text-muted)]">{t("serversPage.windows.certificateHelp")}</p>
    <CheckboxField label={t("serversPage.windows.ignoreCertificate")} name="rdpIgnoreCertificate" defaultChecked={ignoreCertificate} className="pt-1" />
  </div>;
}
