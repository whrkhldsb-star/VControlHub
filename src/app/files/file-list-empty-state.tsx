"use client";

/**
 * Empty folder / no search results, shared by the list and grid views.
 */
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";
import { ArrowLeft, FolderOpen } from "@/components/icons";

export type FileListEmptyStateProps = {
  emptyMessage: string;
  onGoUp?: () => void;
};

export function FileListEmptyState({ emptyMessage, onGoUp }: FileListEmptyStateProps) {
  const { t } = useI18n();
  return (
    <div data-empty-state className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-full bg-[var(--surface-subtle)] text-[var(--text-muted)]">
        <FolderOpen size={26} />
      </span>
      <p className="text-sm text-[var(--text-secondary)]">{emptyMessage}</p>
      {onGoUp ? (
        <>
          <p className="text-xs text-[var(--text-muted)]">{t("fileListClient.upLevelHint")}</p>
          <ActionButton variant="secondary" size="sm" icon={<ArrowLeft aria-hidden />} onClick={onGoUp} data-testid="files-empty-up-level">
            {t("fileListClient.upLevel")}
          </ActionButton>
        </>
      ) : null}
    </div>
  );
}
