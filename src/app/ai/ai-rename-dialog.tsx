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
      size="sm"
      open={open}
      onClose={onCancel}
      labelledBy="rename-conversation-title"
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
          <ActionButton size="sm" type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            {t("aiPage.cancel")}
          </ActionButton>
          <ActionButton size="sm" type="button" variant="ghost" disabled={busy || !title.trim()} onClick={onConfirm}>
            {busy ? t("aiPage.savingLabel") : t("aiPage.saveTitleLabel")}
          </ActionButton>
        </div>
    </ModalShell>
  );
}
