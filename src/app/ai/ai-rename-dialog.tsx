"use client";

import { ActionButton } from "@/components/action-button";
import { ModalShell } from "@/components/modal-shell";
import { UI_INPUT } from "@/lib/ui/classes";
/**
 * Modal dialog for renaming an AI conversation.
 *
 * Extracted from ai-client.tsx in R31. Open/close + value control lives
 * in the parent; this component owns only the layout and a11y wiring.
 */
import { useI18n } from "@/lib/i18n/use-locale";

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
  return (
    <ModalShell
      open={open}
      onClose={onCancel}
      labelledBy="rename-conversation-title"
      overlayClassName="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay)] px-4 backdrop-blur-sm"
      panelClassName="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl"
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
            className={UI_INPUT}
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
    </ModalShell>
  );
}
