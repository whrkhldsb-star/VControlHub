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
};

export function FileListToolbar({
  itemCount,
  selectedCount,
  viewMode,
  onChangeViewMode,
}: FileListToolbarProps) {
  const { t } = useI18n();
  return (
    <div className="flex items-center justify-between bg-[var(--surface)]/[0.04] px-5 py-2.5 border-b border-[var(--border)]">
      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
        <span>{itemCount} 项</span>
        {selectedCount > 0 ? (
          <span className="text-[var(--color-action)] font-medium">
            · 已选 {selectedCount} 个
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-[var(--modal-bg)] p-1">
        <button
          type="button"
          onClick={() => onChangeViewMode("list")}
          title={t("fileListClient.listView")}
          aria-label={t("fileListClient.listView")}
          aria-pressed={viewMode === "list"}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            viewMode === "list"
              ? "bg-[var(--color-action-bg)]/20 text-[var(--text-primary)] border border-[var(--color-action-border)]/30 shadow-sm shadow-[var(--color-action)]/10"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)]/10 border border-transparent"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="8" y1="6" x2="21" y2="6" />
            <line x1="8" y1="12" x2="21" y2="12" />
            <line x1="8" y1="18" x2="21" y2="18" />
            <line x1="3" y1="6" x2="3.01" y2="6" />
            <line x1="3" y1="12" x2="3.01" y2="12" />
            <line x1="3" y1="18" x2="3.01" y2="18" />
          </svg>
          列表
        </button>
        <button
          type="button"
          onClick={() => onChangeViewMode("grid")}
          title={t("fileListClient.iconView")}
          aria-label={t("fileListClient.iconView")}
          aria-pressed={viewMode === "grid"}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            viewMode === "grid"
              ? "bg-[var(--color-action-bg)]/20 text-[var(--text-primary)] border border-[var(--color-action-border)]/30 shadow-sm shadow-[var(--color-action)]/10"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)]/10 border border-transparent"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
          </svg>
          图标
        </button>
        <button
          type="button"
          onClick={() => onChangeViewMode("details")}
          title={t("fileListClient.detailView")}
          aria-label={t("fileListClient.detailView")}
          aria-pressed={viewMode === "details"}
          className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
            viewMode === "details"
              ? "bg-[var(--color-action-bg)]/20 text-[var(--text-primary)] border border-[var(--color-action-border)]/30 shadow-sm shadow-[var(--color-action)]/10"
              : "text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--surface)]/10 border border-transparent"
          }`}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
            <line x1="3" y1="9" x2="9" y2="9" />
            <line x1="3" y1="15" x2="9" y2="15" />
          </svg>
          详情
        </button>
      </div>
    </div>
  );
}
