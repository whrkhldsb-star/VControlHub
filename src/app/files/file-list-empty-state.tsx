"use client";

/**
 * Shared empty-folder UI for list/grid/details/mobile file views.
 * Keeps up-level CTA + i18n in one place to avoid four-way drift.
 */
import type { ReactNode } from "react";
import { useI18n } from "@/lib/i18n/use-locale";

export type FileListEmptyStateProps = {
  emptyMessage: string;
  onGoUp?: () => void;
  /** Optional leading icon (e.g. grid view folder silhouette). */
  icon?: ReactNode;
  /** Wrapper classes for the outer empty container. */
  className?: string;
  /** Classes for the empty message paragraph. */
  messageClassName?: string;
};

export function FileListEmptyState({
  emptyMessage,
  onGoUp,
  icon,
  className = "px-6 py-16 text-center text-sm text-[var(--text-muted)]",
  messageClassName,
}: FileListEmptyStateProps) {
  const { t } = useI18n();
  return (
    <div className={className}>
      {icon}
      <p className={messageClassName}>{emptyMessage}</p>
      {onGoUp ? (
        <>
          <button
            type="button"
            onClick={onGoUp}
            data-testid="files-empty-up-level"
            data-action-button
            data-variant="secondary"
            className="mt-4 inline-flex items-center gap-1.5 !px-4 !py-2 !text-sm"
          >
            <span aria-hidden="true">↑</span>
            {t("fileListClient.upLevel")}
          </button>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("fileListClient.upLevelHint")}</p>
        </>
      ) : null}
    </div>
  );
}
