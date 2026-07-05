"use client";

/**
 * Batch operation hooks for file list — delete / move / compress.
 *
 * Extracted from file-list-client.tsx in R31 (super-large client component
 * decomposition). Centralizes the three batch action callbacks that share
 * the same selection/progress/router state, so the main component is no
 * longer responsible for orchestrating cross-cutting batch state machines.
 *
 * Each hook returns a single `useCallback`-wrapped handler with all the
 * progress / toast / refresh side-effects encapsulated inside. The
 * caller owns a single `useTransition()` and passes its `startTransition`
 * down, so `isPending` remains consistent across all three actions (the
 * file-batch-toolbar reads one pending flag).
 */
import { useCallback, type TransitionStartFunction } from "react";
import type { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { deleteFileEntryAction } from "../storage/actions";
import { moveFileAction } from "./move-file-action";
import type { FileProp } from "./file-entry-utils";
import type {
  BatchAction,
  BatchProgress,
} from "./use-file-selection";

type ToastFn = (type: "success" | "error" | "info", message: string) => void;

type Setter<T> = (value: T) => void;

type CommonInput = {
  /** Read-only list of currently-effective selected file ids (string[] from getSelectionSummary). */
  effectiveSelectedIds: readonly string[];
  files: FileProp[];
  router: ReturnType<typeof useRouter>;
  clearSelection: () => void;
  onRefresh?: () => void;
  currentSelectionScopeKey: string;
  showToast: ToastFn;
  t: (key: string) => string;
  setBatchAction: Setter<BatchAction>;
  setSelectedIds: Setter<Set<string>>;
  setSelectedScopeKey: Setter<string>;
  startTransition: TransitionStartFunction;
};

export type UseBatchDeleteInput = CommonInput & {
  setProgress: Setter<BatchProgress>;
};

export type UseBatchMoveInput = CommonInput & {
  moveTargetDir: string;
  setMoveProgress: Setter<BatchProgress>;
};

export type UseBatchCompressInput = CommonInput & {
  currentPath: string;
  setProgress: Setter<BatchProgress>;
};

/**
 * Hook factory returning a single batch-delete callback. Iterates over
 * the currently-effective selection, calls `deleteFileEntryAction` for
 * each, aggregates errors, and surfaces success/failure as a toast.
 */
export function useBatchDelete(input: UseBatchDeleteInput) {
  const {
    effectiveSelectedIds,
    files,
    router,
    clearSelection,
    onRefresh,
    currentSelectionScopeKey,
    showToast,
    t,
    setBatchAction,
    setProgress,
    setSelectedIds,
    setSelectedScopeKey,
    startTransition,
  } = input;

  return useCallback(() => {
    setBatchAction("deleting");
    const ids = [...effectiveSelectedIds];
    setProgress({ done: 0, total: ids.length, errors: [] });
    let completed = 0;
    const errors: string[] = [];
    startTransition(async () => {
      for (const id of ids) {
        const file = files.find((item) => item.id === id);
        const formData = new FormData();
        formData.set("fileEntryId", id);
        const result = await deleteFileEntryAction(null, formData);
        completed++;
        if (result?.error) {
          errors.push(`${file?.name ?? id}: ${result.error}`);
        }
        setProgress({
          done: completed,
          total: ids.length,
          errors: [...errors],
        });
      }
      if (onRefresh) {
        onRefresh();
      } else {
        router.refresh();
      }
      if (errors.length === 0) {
        showToast("success", t("filesPage.batch.deleteSuccess").replace("{count}", String(ids.length)));
        clearSelection();
        return;
      }
      showToast("error", t("filesPage.batch.deletePartialFailure").replace("{count}", String(errors.length)));
      setBatchAction("none");
      setSelectedScopeKey(currentSelectionScopeKey);
      setSelectedIds(new Set(ids));
      setProgress({ done: completed, total: ids.length, errors: [...errors] });
    });
  }, [
    effectiveSelectedIds,
    files,
    router,
    clearSelection,
    onRefresh,
    currentSelectionScopeKey,
    showToast,
    t,
    setBatchAction,
    setProgress,
    setSelectedIds,
    setSelectedScopeKey,
    startTransition,
  ]);
}

/**
 * Hook factory returning a single batch-move callback. Reads
 * `moveTargetDir` and dispatches `moveFileAction` per selected file.
 * Guards against empty input early so a stray button press is a no-op.
 */
export function useBatchMove(input: UseBatchMoveInput) {
  const {
    effectiveSelectedIds,
    moveTargetDir,
    files,
    router,
    clearSelection,
    onRefresh,
    currentSelectionScopeKey,
    showToast,
    t,
    setBatchAction,
    setMoveProgress,
    setSelectedIds,
    setSelectedScopeKey,
    startTransition,
  } = input;

  return useCallback(() => {
    const ids = [...effectiveSelectedIds];
    const targetDir = moveTargetDir.trim();
    if (!targetDir || ids.length === 0) return;
    setMoveProgress({ done: 0, total: ids.length, errors: [] });
    let completed = 0;
    const errors: string[] = [];
    startTransition(async () => {
      for (const id of ids) {
        const file = files.find((f) => f.id === id);
        if (!file) {
          errors.push(t("filesPage.batch.fileMissing").replace("{id}", id));
          completed++;
          setMoveProgress({
            done: completed,
            total: ids.length,
            errors: [...errors],
          });
          continue;
        }
        const formData = new FormData();
        formData.set("fileEntryId", id);
        formData.set("targetDir", targetDir);
        formData.set("currentRelativePath", file.relativePath);
        formData.set("storageNodeId", file.storageNodeId);
        const result = await moveFileAction(null, formData);
        completed++;
        if (result?.error) errors.push(`${file.name}: ${result.error}`);
        setMoveProgress({
          done: completed,
          total: ids.length,
          errors: [...errors],
        });
      }
      if (onRefresh) {
        onRefresh();
      } else {
        router.refresh();
      }
      if (errors.length === 0) {
        showToast("success", t("filesPage.batch.moveSuccess").replace("{count}", String(ids.length)));
        clearSelection();
        return;
      }
      showToast("error", t("filesPage.batch.movePartialFailure").replace("{count}", String(errors.length)));
      setBatchAction("none");
      setSelectedScopeKey(currentSelectionScopeKey);
      setSelectedIds(new Set(ids));
      setMoveProgress({
        done: completed,
        total: ids.length,
        errors: [...errors],
      });
    });
  }, [
    effectiveSelectedIds,
    moveTargetDir,
    files,
    router,
    clearSelection,
    onRefresh,
    currentSelectionScopeKey,
    showToast,
    t,
    setBatchAction,
    setMoveProgress,
    setSelectedIds,
    setSelectedScopeKey,
    startTransition,
  ]);
}

/**
 * Hook factory returning a single batch-compress callback. Posts to
 * `/api/files/compress` with the relative paths of the current
 * selection. Refuses cross-storage-node selections (the API can only
 * write into a single mount).
 */
export function useBatchCompress(input: UseBatchCompressInput) {
  const {
    effectiveSelectedIds,
    files,
    router,
    clearSelection,
    onRefresh,
    currentPath,
    currentSelectionScopeKey,
    showToast,
    t,
    setBatchAction,
    setProgress,
    setSelectedIds,
    setSelectedScopeKey,
    startTransition,
  } = input;

  return useCallback(() => {
    const ids = [...effectiveSelectedIds];
    const selectedFiles = ids
      .map((id) => files.find((file) => file.id === id))
      .filter((file): file is FileProp => Boolean(file));
    if (selectedFiles.length === 0) return;

    const storageNodeId = selectedFiles[0]!.storageNodeId;
    if (selectedFiles.some((file) => file.storageNodeId !== storageNodeId)) {
      showToast("error", t("filesPage.batch.compressCrossStorageUnsupported"));
      return;
    }

    setBatchAction("compressing");
    setProgress({ done: 0, total: selectedFiles.length, errors: [] });
    startTransition(async () => {
      try {
        const stamp = new Date().toISOString().replace(/[:.]/g, "-");
        const data = await csrfFetch("/api/files/compress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storageNodeId,
            relativePaths: selectedFiles.map((file) => file.relativePath),
            targetDir: currentPath,
            outputName: `selected-${stamp}.tar.gz`,
          }),
        });
        if (data.error) throw new Error(data.error);
        setProgress({
          done: selectedFiles.length,
          total: selectedFiles.length,
          errors: [],
        });
        showToast(
          "success",
          data.message ?? t("filesPage.batch.compressSuccess").replace("{count}", String(selectedFiles.length)),
        );
        if (onRefresh) {
          onRefresh();
        } else {
          router.refresh();
        }
        clearSelection();
      } catch (error) {
        const message = error instanceof Error ? error.message : t("filesPage.batch.compressFailed");
        setProgress({
          done: 0,
          total: selectedFiles.length,
          errors: [message],
        });
        showToast("error", message);
        setBatchAction("none");
        setSelectedScopeKey(currentSelectionScopeKey);
        setSelectedIds(new Set(ids));
      }
    });
  }, [
    effectiveSelectedIds,
    files,
    showToast,
    t,
    setBatchAction,
    setProgress,
    currentPath,
    onRefresh,
    router,
    clearSelection,
    currentSelectionScopeKey,
    setSelectedIds,
    setSelectedScopeKey,
    startTransition,
  ]);
}
