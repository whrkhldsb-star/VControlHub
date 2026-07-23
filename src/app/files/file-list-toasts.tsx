"use client";

/**
 * Floating toast stack — anchored top-center, used by the file list to
 * surface batch action results (delete/move/compress success/failure).
 *
 * Extracted from file-list-client.tsx in R31. Visual / a11y identical
 * to the inline version that lived in the main component before.
 */
import { useI18n } from "@/lib/i18n/use-locale";
import type { FileToast } from "./use-file-toast";

export type FileListToastsProps = {
  toasts: FileToast[];
  onDismiss: (id: number) => void;
};

export function FileListToasts({ toasts, onDismiss }: FileListToastsProps) {
  const { t } = useI18n();
  if (toasts.length === 0) return null;
  return (
    <div
      className="fixed left-1/2 top-4 z-[70] flex w-[min(92vw,520px)] -translate-x-1/2 flex-col gap-2"
      aria-live="polite"
      aria-atomic="true"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.type ==="error" ?"alert" :"status"}
          className={["flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl",
            toast.type ==="success"
              ?"border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--text-primary)] shadow-[var(--success-bg)]"
              :"",
            toast.type ==="error"
              ?"border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--text-primary)] shadow-[var(--danger-bg)]"
              :"",
            toast.type ==="info"
              ?"border-[var(--color-action-border)]/40 bg-[var(--accent)] text-[var(--on-accent)] shadow-[var(--shadow-md)]"
              :"",
          ].join(" ")}
        >
          <span>{toast.message}</span>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="rounded-full px-1.5 text-[var(--text-primary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]"
            aria-label={t("fileListClient.closeNotice")}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
