"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/use-locale";

interface AiConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  error?: string | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function AiConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = true,
  error,
  busy = false,
  onCancel,
  onConfirm,
}: AiConfirmDialogProps) {
  const { t } = useI18n();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{description}</div>
        {error && (
          <div role="alert" className="mt-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 disabled:opacity-50"
          >
            {t("aiPage.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-xl px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
 danger
 ?"bg-[var(--danger-bg)] text-[var(--danger)] hover:bg-[var(--danger-bg)]"
 :"bg-[var(--color-action)]/20 text-[var(--text-secondary)] hover:bg-[var(--color-action)]/30"
 }`}
          >
            {busy ? t("aiPage.processing") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
