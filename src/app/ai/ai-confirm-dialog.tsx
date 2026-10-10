"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { Dialog } from "@/components/ui/dialog";

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
    <Dialog
      size="sm"
      open={open}
      onClose={onCancel}
      busy={busy}
      title={title}
      footer={<>
        <ActionButton type="button" variant="secondary" onClick={onCancel} disabled={busy}>
          {t("aiPage.cancel")}
        </ActionButton>
        <ActionButton type="button" variant={danger ? "danger-solid" : "primary"} onClick={onConfirm} loading={busy}>
          {busy ? t("aiPage.processing") : confirmLabel}
        </ActionButton>
      </>}
    >
      <div className="text-sm leading-6 text-[var(--text-secondary)]">{description}</div>
      {error ? <Notice tone="danger" compact className="mt-3">{error}</Notice> : null}
    </Dialog>
  );
}
