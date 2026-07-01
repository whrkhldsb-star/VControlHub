"use client";

/**
 * Modal dialog for renaming an AI conversation.
 *
 * Extracted from ai-client.tsx in R31. Open/close + value control lives
 * in the parent; this component owns only the layout and a11y wiring.
 */
import { useI18n } from "@/lib/i18n/use-locale";

type Props = {
  open: boolean;
  title: string;
  busy: boolean;
  error: string | null;
  onChangeTitle: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
};

export function AiRenameDialog({
  open,
  title,
  busy,
  error,
  onChangeTitle,
  onCancel,
  onConfirm,
}: Props) {
  const { t } = useI18n();
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="rename-conversation-title"
        className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl"
      >
        <h3
          id="rename-conversation-title"
          className="text-sm font-semibold text-[var(--text-primary)]"
        >
          {t("aiPage.renameTitle")}
        </h3>
        <label
          htmlFor="rename-conversation-title-input"
          className="mt-4 grid gap-1 text-sm text-[var(--text-secondary)]"
        >
          {t("aiPage.newTitleLabel")}
          <input
            id="rename-conversation-title-input"
            value={title}
            onChange={(event) => onChangeTitle(event.target.value)}
            autoFocus
            className="rounded-xl border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-cyan-300/60"
            placeholder={t("aiPage.newTitlePlaceholder")}
          />
        </label>
        {error && (
          <p role="alert" className="mt-3 text-xs text-rose-300">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-xl border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/5 disabled:opacity-50"
          >
            {t("aiPage.cancel")}
          </button>
          <button
            type="button"
            disabled={busy || !title.trim()}
            onClick={onConfirm}
            className="rounded-xl bg-cyan-500/20 px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-cyan-500/30 disabled:opacity-50"
          >
            {busy ? t("aiPage.savingLabel") : t("aiPage.saveTitleLabel")}
          </button>
        </div>
      </div>
    </div>
  );
}
