"use client";

type TFunction = (key: string) => string;

import type { DirEntry } from "./ssh-file-manager-parts";
import { ConfirmDialog } from "./confirm-dialog";

type DeleteDialogProps = {
  entry: DirEntry | null;
  onCancel: () => void;
  onConfirm: (entry: DirEntry) => void;
  t: TFunction;
};

export function SshDeleteDialog({ entry, onCancel, onConfirm, t }: DeleteDialogProps) {
  return <ConfirmDialog open={entry !== null} title={t("common.confirmDelete")} description={entry ? t("sshFileManager.confirmDelete").replace("{name}", entry.name) : ""} cancelLabel={t("common.cancel")} confirmLabel={t("common.confirmDelete")} onCancel={onCancel} onConfirm={() => entry && onConfirm(entry)} closeOnBackdrop={false} />;
}
