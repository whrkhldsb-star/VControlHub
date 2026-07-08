"use client";

type TFunction = (key: string) => string;

import type { DirEntry } from "./ssh-file-manager-parts";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

type DeleteDialogProps = {
  entry: DirEntry | null;
  onCancel: () => void;
  onConfirm: (entry: DirEntry) => void;
  t: TFunction;
};

export function SshDeleteDialog({ entry, onCancel, onConfirm, t }: DeleteDialogProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: entry !== null, onClose: onCancel });
  if (!entry) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)]/70 px-4 backdrop-blur-sm" role="presentation">
      <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="ssh-file-delete-title" className="w-full max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-[0_24px_100px_rgba(244,63,94,0.16)]">
        <h3 id="ssh-file-delete-title" className="text-lg font-semibold text-[var(--text-primary)]">{t("common.confirmDelete")}</h3>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">{t("sshFileManager.confirmDelete").replace("{name}", entry.name)}</p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">{t("common.cancel")}</button>
          <button type="button" onClick={() => onConfirm(entry)} className="min-h-11 rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--danger)]">{t("common.confirmDelete")}</button>
        </div>
      </section>
    </div>
  );
}
