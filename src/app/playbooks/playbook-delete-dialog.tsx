"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import type { SerializedPlaybook } from "./playbook-types";

type PlaybookDeleteDialogProps = {
  playbook: SerializedPlaybook | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

export function PlaybookDeleteDialog({ playbook, busy, onCancel, onConfirm }: PlaybookDeleteDialogProps) {
  const { t } = useI18n();
  if (!playbook) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface)] px-4 backdrop-blur-sm" role="presentation">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-playbook-title"
        className="w-full max-w-md rounded-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-6 shadow-2xl"
      >
        <h2 id="delete-playbook-title" className="text-lg font-semibold text-[var(--text-primary)]">
          {t("playbooksPage.delete.title")}
        </h2>
        <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
          {t("playbooksPage.delete.confirm").replace("{name}", playbook.name)}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
          >
            {t("playbooksPage.delete.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="min-h-11 rounded-xl bg-[var(--danger)] px-4 py-2 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--danger)] disabled:opacity-50"
          >
            {busy ? t("playbooksPage.action.deleting") : t("playbooksPage.delete.confirmBtn")}
          </button>
        </div>
      </section>
    </div>
  );
}
