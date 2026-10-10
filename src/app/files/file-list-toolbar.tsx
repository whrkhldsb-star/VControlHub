"use client";

/**
 * View-mode toggle header bar — sits above the file list and lets the
 * user switch between list / grid (icon) / details layouts. Also shows
 * the current item count + selection count.
 *
 * Extracted from file-list-client.tsx in R31.
 */
import { useI18n } from "@/lib/i18n/use-locale";
import type { ViewMode } from "./use-view-mode";
import { ActionButton } from "@/components/action-button";
import { StatusBadge } from "@/components/status-badge";
import { SegmentedControl } from "@/components/ui-primitives";
import { FileCollections } from "./file-preferences-client";
import { FileOperationTasks } from "./file-operation-controls";

export type FileListToolbarProps = {
  itemCount: number;
  selectedCount: number;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  onGoUp?: () => void;
};


export function FileListToolbar({
  itemCount,
  selectedCount,
  viewMode,
  onChangeViewMode,
  onGoUp,
}: FileListToolbarProps) {
  const { t } = useI18n();
  return (
    <div
      data-toolbar
      className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--surface)_92%,transparent)] px-4 py-2.5 sm:px-5"
    >
      <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-muted)]">
        <FileCollections />
        <FileOperationTasks />
        {onGoUp ? (
          <ActionButton size="sm" variant="secondary"
            onClick={onGoUp}
            data-testid="files-list-up-level"
            title={t("fileListClient.upLevel")} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true">↑</span>
            {t("fileListClient.upLevel")}
          </ActionButton>
        ) : null}
        <StatusBadge tone="neutral">
          {t("filesPage.list.itemCount", { count: itemCount })}
        </StatusBadge>
        {selectedCount > 0 ? (
          <StatusBadge tone="accent">
            {t("filesPage.list.selectedCount", { count: selectedCount })}
          </StatusBadge>
        ) : null}
      </div>
      <SegmentedControl
        ariaLabel={t("fileListClient.viewMode")}
        size="sm"
        compactLabels
        value={viewMode}
        onChange={onChangeViewMode}
        options={[
          { value: "list", label: t("filesPage.list.viewList"), ariaLabel: t("fileListClient.listView"), title: t("fileListClient.listView"), icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <line x1="8" y1="6" x2="21" y2="6" />
                    <line x1="8" y1="12" x2="21" y2="12" />
                    <line x1="8" y1="18" x2="21" y2="18" />
                    <line x1="3" y1="6" x2="3.01" y2="6" />
                    <line x1="3" y1="12" x2="3.01" y2="12" />
                    <line x1="3" y1="18" x2="3.01" y2="18" />
                  </svg>
          ) },
          { value: "grid", label: t("filesPage.list.viewGrid"), ariaLabel: t("fileListClient.iconView"), title: t("fileListClient.iconView"), icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                  </svg>
          ) },
          { value: "details", label: t("filesPage.list.viewDetails"), ariaLabel: t("fileListClient.detailView"), title: t("fileListClient.detailView"), icon: (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="3" width="18" height="18" rx="2" />
                    <line x1="9" y1="3" x2="9" y2="21" />
                    <line x1="3" y1="9" x2="9" y2="9" />
                    <line x1="3" y1="15" x2="9" y2="15" />
                  </svg>
          ) },
        ]}
      />
    </div>
  );
}
