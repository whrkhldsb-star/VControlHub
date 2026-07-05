"use client";

/**
 * FileBatchToolbar — the fixed bottom toolbar that appears once the
 * user selects one or more files. Hosts bulk delete / move actions
 * and surfaces per-batch progress.
 *
 * Extracted from `file-list-client.tsx` (TR-036 T36b) so the parent
 * chunk does not pull in the form state machines and the
 * `MoveInlineForm` / `DeleteConfirmButton` import graph until the
 * user actually has a non-empty selection. The wrapping
 * `FileBatchToolbarLazy` uses `next/dynamic` to defer the chunk.
 */
import { useId } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import type { BatchAction, BatchProgress } from "./use-file-selection";

export type FileBatchToolbarProps = {
  selectedCount: number;
  batchAction: BatchAction;
  setBatchAction: (action: BatchAction) => void;
  progress: BatchProgress;
  moveProgress: BatchProgress;
  moveTargetDir: string;
  setMoveTargetDir: (dir: string) => void;
  setMoveProgress: (next: BatchProgress) => void;
  isPending: boolean;
  canDelete: boolean;
  selectedEntriesCanDelete: boolean;
  selectedEntriesCanMove: boolean;
  selectedScopeMatches: boolean;
  currentPath: string;
  onClearSelection: () => void;
  onConfirmDelete: () => void;
  onSubmitMove: () => void;
  onCompressSelected: () => void;
};

export function FileBatchToolbar({
  selectedCount,
  batchAction,
  setBatchAction,
  progress,
  moveProgress,
  moveTargetDir,
  setMoveTargetDir,
  setMoveProgress,
  isPending,
  canDelete,
  selectedEntriesCanDelete,
  selectedEntriesCanMove,
  selectedScopeMatches,
  currentPath,
  onClearSelection,
  onConfirmDelete,
  onSubmitMove,
  onCompressSelected,
}: FileBatchToolbarProps) {
  const { t } = useI18n();
  const copy = {
    errorSummary: t("filesPage.batchToolbar.errorSummary"),
    regionTitle: t("filesPage.batchToolbar.regionTitle"),
    regionDescription: t("filesPage.batchToolbar.regionDescription"),
    confirmDeletePrompt: t("filesPage.batchToolbar.confirmDeletePrompt"),
    confirmDelete: t("filesPage.batchToolbar.confirmDelete"),
    cancel: t("filesPage.batchToolbar.cancel"),
    deleteProgress: t("filesPage.batchToolbar.deleteProgress"),
    failureCount: t("filesPage.batchToolbar.failureCount"),
    failureCountParen: t("filesPage.batchToolbar.failureCountParen"),
    compressing: t("filesPage.batchToolbar.compressing"),
    targetPathLabel: t("filesPage.batchToolbar.targetPathLabel"),
    targetPathPlaceholder: t("filesPage.batchToolbar.targetPathPlaceholder"),
    moveProgress: t("filesPage.batchToolbar.moveProgress"),
    confirmMove: t("filesPage.batchToolbar.confirmMove"),
    selectedCount: t("filesPage.batchToolbar.selectedCount"),
    clearSelection: t("filesPage.batchToolbar.clearSelection"),
    compressSelected: t("filesPage.batchToolbar.compressSelected"),
    deleteSelected: t("filesPage.batchToolbar.deleteSelected"),
    moveSelected: t("filesPage.batchToolbar.moveSelected"),
  };
  const formatCopy = (template: string, replacements: Record<string, string | number>) =>
    Object.entries(replacements).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
  const fileListId = useId();
  const batchToolbarTitleId = `${fileListId}-batch-toolbar-title`;
  const batchToolbarDescriptionId = `${fileListId}-batch-toolbar-description`;
  const batchErrorTitleId = `${fileListId}-batch-error-title`;

  return (
    <>
      {selectedScopeMatches &&
      (progress.errors.length > 0 || moveProgress.errors.length > 0) ? (
        <div
          role="alert"
          aria-labelledby={batchErrorTitleId}
          className="fixed bottom-20 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-2xl border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3 text-sm text-[var(--warning)] shadow-2xl"
        >
          <p id={batchErrorTitleId} className="font-medium">
            {formatCopy(copy.errorSummary, { count: progress.errors.length + moveProgress.errors.length })}
          </p>
          <ul className="mt-1 max-h-28 overflow-y-auto text-xs text-[var(--warning)]0/80">
            {[...progress.errors, ...moveProgress.errors].map((error) => (
              <li key={error}>• {error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {selectedCount > 0 ? (
        <div
          role="region"
          aria-labelledby={batchToolbarTitleId}
          aria-describedby={batchToolbarDescriptionId}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-[var(--modal-bg)] backdrop-blur border border-[var(--border)] rounded-2xl shadow-2xl px-5 py-3"
        >
          <span id={batchToolbarTitleId} className="sr-only">
            {copy.regionTitle}
          </span>
          <span id={batchToolbarDescriptionId} className="sr-only">
            {formatCopy(copy.regionDescription, { count: selectedCount })}
          </span>
          {batchAction === "confirm-delete" ? (
            <>
              <span className="text-sm text-[var(--danger)]">
                {formatCopy(copy.confirmDeletePrompt, { count: selectedCount })}
              </span>
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={isPending}
                data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-50"
              >
                {copy.confirmDelete}
              </button>
              <button
                type="button"
                onClick={() => setBatchAction("none")}
                disabled={isPending}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 disabled:opacity-50"
              >
                {copy.cancel}
              </button>
            </>
          ) : batchAction === "deleting" ? (
            <>
              <span className="text-sm text-[var(--danger)]">
                {formatCopy(copy.deleteProgress, { done: progress.done, total: progress.total })}
              </span>
              {progress.done < progress.total ? (
                <div className="h-2 w-24 overflow-hidden rounded-full bg-[var(--surface)]/10">
                  <div
                    className="h-full rounded-full bg-[var(--danger)] transition-[width]"
                    style={{
                      width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              ) : null}
              {progress.errors.length > 0 ? (
                <span className="text-sm text-[var(--warning)]">
                  {formatCopy(copy.failureCount, { count: progress.errors.length })}
                </span>
              ) : null}
            </>
          ) : batchAction === "compressing" ? (
            <>
              <span className="text-sm text-[var(--text-secondary)]">
                {copy.compressing}
              </span>
              {progress.total > 0 ? (
                <span className="text-sm text-[var(--text-secondary)]">
                  {progress.done}/{progress.total}
                  {progress.errors.length > 0
                    ? `（${formatCopy(copy.failureCount, { count: progress.errors.length })}）`
                    : ""}
                </span>
              ) : null}
            </>
          ) : batchAction === "moving" ? (
            <>
              <span className="text-sm text-[var(--text-secondary)]">
                {copy.targetPathLabel}
              </span>
              <input
                type="text"
                value={moveTargetDir}
                aria-label="Batch move target path"
                onChange={(e) => setMoveTargetDir(e.currentTarget.value)}
                placeholder={currentPath || copy.targetPathPlaceholder}
                className="w-40 rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
              />
              {moveProgress.total > 0 ? (
                <span className="text-sm text-[var(--text-secondary)]">
                  {formatCopy(copy.moveProgress, { done: moveProgress.done, total: moveProgress.total })}
                  {moveProgress.errors.length > 0
                    ? formatCopy(copy.failureCountParen, { count: moveProgress.errors.length })
                    : ""}
                </span>
              ) : null}
              <button
                type="button"
                onClick={onSubmitMove}
                disabled={
                  !moveTargetDir.trim() || isPending || moveProgress.done > 0
                }
                data-tone="accent"
                className="rounded-lg border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {copy.confirmMove}
              </button>
              <button
                type="button"
                onClick={() => {
                  setBatchAction("none");
                  setMoveTargetDir("");
                  setMoveProgress({ done: 0, total: 0, errors: [] });
                }}
                disabled={isPending && moveProgress.done > 0}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 disabled:opacity-50"
              >
                {copy.cancel}
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-[var(--text-secondary)]">
                {formatCopy(copy.selectedCount, { count: selectedCount })}
              </span>
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10"
              >
                {copy.clearSelection}
              </button>
              {selectedEntriesCanMove ? (
                <button
                  type="button"
                  onClick={onCompressSelected}
                  data-tone="cyan"
                  className="rounded-lg border border-[var(--color-action-border)]/30 px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-action-bg)]/20"
                >
                  {copy.compressSelected}
                </button>
              ) : null}
              {canDelete && selectedEntriesCanDelete ? (
                <button
                  type="button"
                  onClick={() => setBatchAction("confirm-delete")}
                  data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)]"
                >
                  {copy.deleteSelected}
                </button>
              ) : null}
              {selectedEntriesCanMove ? (
                <button
                  type="button"
                  onClick={() => {
                    setMoveTargetDir("");
                    setMoveProgress({ done: 0, total: 0, errors: [] });
                    setBatchAction("moving");
                  }}
                  data-tone="accent"
                  className="rounded-lg border px-4 py-2 text-sm font-medium transition"
                >
                  {copy.moveSelected}
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
