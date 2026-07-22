"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

import { ActionButton } from "@/components/action-button";
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
  const dialogRef = useDialogFocus<HTMLDivElement>({
    open,
    onClose: () => {
      if (!busy) onCancel();
    },
  });
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay)] px-4 backdrop-blur-sm"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{description}</div>
        {error && (
          <div role="alert" className="mt-3 rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <ActionButton type="button" variant="secondary" onClick={onCancel} disabled={busy} className="text-xs">
            {t("aiPage.cancel")}
          </ActionButton>
          <ActionButton
            type="button"
            variant={danger ? "danger" : "ghost"}
            onClick={onConfirm}
            disabled={busy}
            className="text-xs"
          >
            {busy ? t("aiPage.processing") : confirmLabel}
          </ActionButton>
        </div>
      </div>
    </div>
  );
}
