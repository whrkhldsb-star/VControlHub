"use client";

import { ActionButton } from "@/components/action-button";
import { Dialog } from "@/components/ui/dialog";
import { FormField } from "@/components/ui-primitives";
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
    <Dialog
      size="sm"
      open={open}
      onClose={onCancel}
      busy={busy}
      title={t("aiPage.renameTitle")}
      footer={
        <>
          <ActionButton type="button" variant="secondary" disabled={busy} onClick={onCancel}>
            {t("aiPage.cancel")}
          </ActionButton>
          <ActionButton type="button" loading={busy} disabled={!title.trim()} onClick={onConfirm}>
            {busy ? t("aiPage.savingLabel") : t("aiPage.saveTitleLabel")}
          </ActionButton>
        </>
      }
    >
      <FormField label={t("aiPage.newTitleLabel")} htmlFor="rename-conversation-title-input" error={error ?? undefined}>
        <input
          id="rename-conversation-title-input"
          value={title}
          onChange={(event) => onChangeTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && title.trim() && !busy) onConfirm();
          }}
          autoFocus
          className={UI_INPUT}
          placeholder={t("aiPage.newTitlePlaceholder")}
        />
      </FormField>
    </Dialog>
  );
}
