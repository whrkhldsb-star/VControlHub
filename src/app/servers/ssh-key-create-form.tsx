"use client";
import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { createSshKeyAction, type ServerActionState } from "./actions";
import { useI18n } from "@/lib/i18n/use-locale";
import { UI_INPUT } from "@/lib/ui/classes";
const initialState: ServerActionState = {
  error: undefined,
  success: undefined,
  relatedStorageCount: undefined,
};
export function SshKeyCreateForm() {
  const { t } = useI18n();
  const [state, formAction] = useActionState(createSshKeyAction, initialState);
  const [selectedPpkFileName, setSelectedPpkFileName] = useState<string | null>(
    null,
  );
  return (
    <form action={formAction} data-card className="grid gap-4 ">
      {" "}
      <div>
        {" "}
        <h2 className="text-lg font-semibold text-[var(--text-primary)]">
          {t("serversPage.sshKeyCreate.title")}
        </h2>{" "}
        <p className="mt-1 text-xs text-[var(--text-muted)]">
          {t("serversPage.sshKeyCreate.desc")}
        </p>{" "}
      </div>{" "}
      {state.error && (
        <div className="rounded-lg bg-[var(--danger)]/[0.10] border border-[var(--danger-border)] px-3.5 py-2.5 text-sm text-[var(--danger)] ">
          {state.error}
        </div>
      )}{" "}
      {state.success && (
        <div className="rounded-lg bg-[var(--success)]/[0.10] border border-[var(--success-border)] px-3.5 py-2.5 text-sm text-[var(--success)] ">
          {state.success}
        </div>
      )}{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
          htmlFor="sshKeyName"
        >
          {t("common.name")}
        </label>{" "}
        <input
          id="sshKeyName"
          name="name"
          type="text"
          required
          placeholder={t("serversPage.sshKeyCreate.namePlaceholder")}
          className={UI_INPUT}
        />{" "}
      </div>{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
          htmlFor="sshKeyDesc"
        >
          {t("serversPage.create.description")}
        </label>{" "}
        <input
          id="sshKeyDesc"
          name="description"
          type="text"
          placeholder={t("common.optional")}
          className={UI_INPUT}
        />{" "}
      </div>{" "}
      <div
        data-tone="cyan"
        className="rounded-lg border border-[var(--color-action-border)]/15 px-3.5 py-2.5 text-xs leading-relaxed text-[var(--text-primary)]"
      >
        {t("serversPage.sshKeyCreate.formatHint")}
      </div>{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
          htmlFor="privateKey"
        >
          {t("serversPage.sshKeyCreate.privateKeyLabel")}
        </label>{" "}
        <textarea
          id="privateKey"
          name="privateKey"
          rows={4}
          placeholder={t("serversPage.sshKeyCreate.privateKeyPlaceholder")}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface-elevated)] resize-y"
        />{" "}
      </div>{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
          htmlFor="publicKey"
        >
          {t("serversPage.sshKeyCreate.publicKeyLabel")}
        </label>{" "}
        <textarea
          id="publicKey"
          name="publicKey"
          rows={2}
          placeholder="ssh-rsa AAAA..."
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] font-mono outline-none transition placeholder:text-[var(--text-primary)]/30 focus:border-[var(--color-action-border)]/30 focus:bg-[var(--surface-elevated)] resize-y"
        />{" "}
      </div>{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
          htmlFor="passphrase"
        >
          {t("serversPage.sshKeyCreate.passphraseLabel")}
        </label>{" "}
        <input
          id="passphrase"
          name="passphrase"
          type="password"
          autoComplete="new-password"
          placeholder={t("serversPage.sshKeyCreate.passphrasePlaceholder")}
          className={UI_INPUT}
        />{" "}
        <p className="text-xs text-[var(--text-muted)]">
          {t("serversPage.sshKeyCreate.passphraseHint")}
        </p>{" "}
      </div>{" "}
      <div className="space-y-1.5">
        {" "}
        <label
          className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide"
          htmlFor="ppkPassphrase"
        >
          {t("serversPage.sshKeyCreate.ppkPassphraseLabel")}
        </label>{" "}
        <input
          id="ppkPassphrase"
          name="ppkPassphrase"
          type="password"
          autoComplete="new-password"
          placeholder={t("serversPage.sshKeyCreate.ppkPassphrasePlaceholder")}
          className={UI_INPUT}
        />{" "}
      </div>{" "}
      <div className="space-y-1.5">
        {" "}
        <label className="text-xs font-medium text-[var(--text-primary)]/70 tracking-wide">
          {t("serversPage.sshKeyCreate.fileUploadLabel")}
        </label>{" "}
        <div className="flex items-center gap-3">
          {" "}
          <label className="cursor-pointer rounded-lg border border-dashed border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm text-[var(--text-secondary)] hover:bg-[var(--surface-elevated)] transition">
            {" "}
            {selectedPpkFileName ??
              t("serversPage.sshKeyCreate.fileLabel")}{" "}
            <input
              type="file"
              name="ppkFile"
              accept=".ppk,.pem,.key,.id_rsa,.id_ed25519,.id_ecdsa,.id_dsa,.openssh"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                setSelectedPpkFileName(file?.name ?? null);
              }}
            />{" "}
          </label>{" "}
          {selectedPpkFileName && (
            <span className="text-xs text-[var(--text-muted)]">
              {t("serversPage.sshKeyCreate.selectedFile").replace(
                "{name}",
                selectedPpkFileName,
              )}
            </span>
          )}{" "}
        </div>{" "}
      </div>{" "}
      <SubmitButton pendingLabel={t("serversPage.sshKeyCreate.submitting")}>
        {t("serversPage.sshKeyCreate.title")}
      </SubmitButton>{" "}
    </form>
  );
}
