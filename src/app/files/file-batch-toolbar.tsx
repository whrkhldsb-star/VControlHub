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
            批量操作完成，{progress.errors.length + moveProgress.errors.length}{" "}
            个失败
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
            文件批量操作
          </span>
          <span id={batchToolbarDescriptionId} className="sr-only">
            已选择 {selectedCount}{" "}
            个文件，可取消选择或执行当前权限允许的批量操作。
          </span>
          {batchAction === "confirm-delete" ? (
            <>
              <span className="text-sm text-[var(--danger)]">
                确认删除 {selectedCount} 个文件？
              </span>
              <button
                type="button"
                onClick={onConfirmDelete}
                disabled={isPending}
                data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:opacity-50"
              >
                确认删除
              </button>
              <button
                type="button"
                onClick={() => setBatchAction("none")}
                disabled={isPending}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 disabled:opacity-50"
              >
                取消
              </button>
            </>
          ) : batchAction === "deleting" ? (
            <>
              <span className="text-sm text-[var(--danger)]">
                已删除 {progress.done}/{progress.total} 个
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
                  {progress.errors.length} 个失败
                </span>
              ) : null}
            </>
          ) : batchAction === "compressing" ? (
            <>
              <span className="text-sm text-[var(--text-secondary)]">
                正在创建压缩包...
              </span>
              {progress.total > 0 ? (
                <span className="text-sm text-[var(--text-secondary)]">
                  {progress.done}/{progress.total}
                  {progress.errors.length > 0
                    ? `（${progress.errors.length} 个失败）`
                    : ""}
                </span>
              ) : null}
            </>
          ) : batchAction === "moving" ? (
            <>
              <span className="text-sm text-[var(--text-secondary)]">
                目标路径：
              </span>
              <input
                type="text"
                value={moveTargetDir}
                onChange={(e) => setMoveTargetDir(e.currentTarget.value)}
                placeholder={currentPath || "目标路径"}
                aria-label="Batch move target path"
                className="w-40 rounded-2xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--color-action-border)]/50 focus:outline-none"
              />
              {moveProgress.total > 0 ? (
                <span className="text-sm text-[var(--text-secondary)]">
                  已移动 {moveProgress.done}/{moveProgress.total} 个
                  {moveProgress.errors.length > 0
                    ? `（${moveProgress.errors.length} 个失败）`
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
                确认移动
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
                取消
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-[var(--text-secondary)]">
                已选 {selectedCount} 个文件
              </span>
              <button
                type="button"
                onClick={onClearSelection}
                className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10"
              >
                取消选择
              </button>
              {selectedEntriesCanMove ? (
                <button
                  type="button"
                  onClick={onCompressSelected}
                  data-tone="cyan"
                  className="rounded-lg border border-[var(--color-action-border)]/30 px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--color-action-bg)]/20"
                >
                  批量压缩
                </button>
              ) : null}
              {canDelete && selectedEntriesCanDelete ? (
                <button
                  type="button"
                  onClick={() => setBatchAction("confirm-delete")}
                  data-tone="rose" className="rounded-lg border border-[var(--danger-border)] px-4 py-2 text-sm font-medium text-[var(--danger)] transition hover:bg-[var(--danger-bg)]"
                >
                  批量删除
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
                  批量移动
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
