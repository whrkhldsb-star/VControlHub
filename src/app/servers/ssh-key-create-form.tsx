"use client";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { createSshKeyAction, type ServerActionState } from "./actions";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
import { Notice } from "@/components/ui-primitives";
import { cn } from "@/lib/ui/cn";

const initialState: ServerActionState = {};

export function SshKeyCreateForm() {
  const { t } = useI18n();
  const [state, formAction] = useActionState(createSshKeyAction, initialState);
  const [hasFile, setHasFile] = useState(false);
  return (
    <form action={formAction} data-card className="grid gap-4" onReset={() => setHasFile(false)}>
      <h2 className="text-lg font-semibold text-[var(--text-primary)]">{t("serversPage.sshKeyCreate.title")}</h2>
      {state.error && <Notice tone="danger">{state.error}</Notice>}
      {state.success && <Notice tone="success">{state.success}</Notice>}
      <div className="space-y-1.5">
        <label htmlFor="sshKeyName">{t("common.name")}</label>
        <input id="sshKeyName" name="name" required className={UI_INPUT} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="publicKey">{t("serversPage.sshKeyCreate.publicKeyLabel")}</label>
        <textarea id="publicKey" name="publicKey" rows={2} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={t("serversPage.sshKeyCreate.publicKeyPlaceholder")} className={cn(UI_INPUT, "resize-y font-mono")} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="privateKey">{t("serversPage.sshKeyCreate.privateKeyLabel")}</label>
        <textarea id="privateKey" name="privateKey" rows={4} required={!hasFile} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder={t("serversPage.sshKeyCreate.privateKeyPlaceholder")} className={cn(UI_INPUT, "resize-y font-mono")} />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="sshKeyFile">{t("serversPage.sshKeyCreate.fileUploadLabel")}</label>
        <input id="sshKeyFile" type="file" name="keyFile" className={UI_INPUT} onChange={event => setHasFile(Boolean(event.target.files?.[0]?.size))} />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer">{t("serversPage.sshKeyCreate.passphraseLabel")}</summary>
        <input aria-label={t("serversPage.sshKeyCreate.passphraseLabel")} name="passphrase" type="password" autoComplete="new-password" placeholder={t("serversPage.sshKeyCreate.passphrasePlaceholder")} className={cn(UI_INPUT, "mt-2")} />
      </details>
      <SubmitButton pendingLabel={t("serversPage.sshKeyCreate.submitting")}>{t("serversPage.sshKeyCreate.title")}</SubmitButton>
    </form>
  );
}
