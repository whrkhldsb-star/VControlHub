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

export type FileListToolbarProps = {
  itemCount: number;
  selectedCount: number;
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  onGoUp?: () => void;
};

function ViewButton({
  active,
  label,
  title,
  onClick,
  children,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--text-primary)] shadow-sm"
          : "border border-transparent text-[var(--text-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
      }`}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

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
        {onGoUp ? (
          <button
            type="button"
            onClick={onGoUp}
            data-testid="files-list-up-level"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs font-medium text-[var(--text-primary)] transition hover:bg-[var(--surface-hover)]"
            title={t("fileListClient.upLevel")}
          >
            <span aria-hidden="true">↑</span>
            {t("fileListClient.upLevel")}
          </button>
        ) : null}
        <span className="inline-flex items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2.5 py-0.5 text-xs font-medium text-[var(--text-secondary)]">
          {t("filesPage.list.itemCount").replace("{count}", String(itemCount))}
        </span>
        {selectedCount > 0 ? (
          <span className="inline-flex items-center rounded-full border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2.5 py-0.5 text-xs font-semibold text-[var(--accent)]">
            {t("filesPage.list.selectedCount").replace("{count}", String(selectedCount))}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--modal-bg)] p-1">
        <ViewButton
          active={viewMode === "list"}
          label={t("filesPage.list.viewList")}
          title={t("fileListClient.listView")}
          onClick={() => onChangeViewMode("list")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
        </ViewButton>
        <ViewButton
          active={viewMode === "grid"}
          label={t("filesPage.list.viewGrid")}
          title={t("fileListClient.iconView")}
          onClick={() => onChangeViewMode("grid")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
        </ViewButton>
        <ViewButton
          active={viewMode === "details"}
          label={t("filesPage.list.viewDetails")}
          title={t("fileListClient.detailView")}
          onClick={() => onChangeViewMode("details")}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <line x1="3" y1="9" x2="9" y2="9" />
            <line x1="3" y1="15" x2="9" y2="15" />
          </svg>
        </ViewButton>
      </div>
    </div>
  );
}
