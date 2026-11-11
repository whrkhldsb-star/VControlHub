"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { ConfirmDialog } from "@/components/confirm-dialog";
import type { SerializedPlaybook } from "./playbook-types";

type PlaybookDeleteDialogProps = {
  playbook: SerializedPlaybook | null;
  busy: boolean;
  /** Why the deletion was refused; shown in the dialog, which stays open. */
  error?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function PlaybookDeleteDialog({ playbook, busy, error, onCancel, onConfirm }: PlaybookDeleteDialogProps) {
  const { t } = useI18n();
  return <ConfirmDialog open={playbook !== null} error={error ?? undefined} title={t("playbooksPage.delete.title")} description={playbook ? t("playbooksPage.delete.confirm", { name: playbook.name }) : ""} cancelLabel={t("playbooksPage.delete.cancel")} confirmLabel={busy ? t("playbooksPage.action.deleting") : t("playbooksPage.delete.confirmBtn")} onCancel={onCancel} onConfirm={onConfirm} busy={busy} />;
}
