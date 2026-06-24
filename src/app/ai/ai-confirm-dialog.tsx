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
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-slate-950 p-5 shadow-2xl"
      >
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <div className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{description}</div>
        {error && (
          <div role="alert" className="mt-3 rounded-xl border border-rose-400/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:bg-white/5 disabled:opacity-50"
          >
            {t("aiPage.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`rounded-xl px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
 danger
 ?"bg-rose-500/20 text-rose-200 hover:bg-rose-500/30"
 :"bg-cyan-500/20 text-cyan-200 hover:bg-cyan-500/30"
 }`}
          >
            {busy ? t("aiPage.processing") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
