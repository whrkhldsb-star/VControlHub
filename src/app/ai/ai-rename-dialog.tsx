"use client";

import { ActionButton } from "@/components/action-button";
/**
 * Modal dialog for renaming an AI conversation.
 *
 * Extracted from ai-client.tsx in R31. Open/close + value control lives
 * in the parent; this component owns only the layout and a11y wiring.
 */
import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

type Props = {
  open: boolean;
  title: string;
  busy: boolean;
  error: string | null;
  onChangeTitle: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AiRenameDialog({
  open,
  title,
  busy,
  error,
  onChangeTitle,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  const dialogRef = useDialogFocus<HTMLDivElement>({ open, onClose: onCancel });
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay)] px-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-conversation-title"
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="rename-conversation-title"
          className="text-sm font-semibold text-[var(--text-primary)]"
        >
          {t("aiPage.renameTitle")}
        </h3>
        <label
          htmlFor="rename-conversation-title-input"
          className="mt-4 grid gap-1 text-sm text-[var(--text-secondary)]"
        >
          {t("aiPage.newTitleLabel")}
          <input
            id="rename-conversation-title-input"
            value={title}
            onChange={(event) => onChangeTitle(event.target.value)}
            autoFocus
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/60"
            placeholder={t("aiPage.newTitlePlaceholder")}
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-xs text-[var(--danger)]">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <ActionButton type="button" variant="secondary" disabled={busy} onClick={onCancel} className="text-xs">
            {t("aiPage.cancel")}
          </ActionButton>
          <ActionButton type="button" variant="ghost" disabled={busy || !title.trim()} onClick={onConfirm} className="text-xs">
            {busy ? t("aiPage.savingLabel") : t("aiPage.saveTitleLabel")}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
