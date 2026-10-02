"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { ModalShell } from "@/components/modal-shell";

import { ActionButton } from "@/components/action-button";
import { Notice } from "@/components/ui-primitives";
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
      size="sm"
      open={open}
      onClose={() => {
        if (!busy) onCancel();
      }}
      labelledBy="ai-confirm-dialog-title"
    >
        <h3 id="ai-confirm-dialog-title" className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
        <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{description}</div>
        {error && (
          <Notice tone="danger" compact>{error}</Notice>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <ActionButton size="sm" type="button" variant="secondary" onClick={onCancel} disabled={busy}>
            {t("aiPage.cancel")}
          </ActionButton>
          <ActionButton size="sm"
            type="button"
            variant={danger ? "danger" : "ghost"}
            onClick={onConfirm}
            disabled={busy}>
            {busy ? t("aiPage.processing") : confirmLabel}
          </ActionButton>
        </div>
    </ModalShell>
  );
}
