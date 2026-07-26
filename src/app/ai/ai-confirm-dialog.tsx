"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { ModalShell } from "@/components/modal-shell";

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
  return (
    <ModalShell
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      labelledBy="ai-confirm-dialog-title"
      overlayClassName="fixed inset-0 z-[60] flex items-center justify-center bg-[var(--overlay)] px-4 backdrop-blur-sm"
      panelClassName="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl"
    >
        <h3 id="ai-confirm-dialog-title" className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
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
    </ModalShell>
  );
}
