"use client";

import { useCallback, useState } from "react";

export type BatchAction = "none" | "confirm-delete" | "deleting" | "moving";

export type BatchProgress = { done: number; total: number; errors: string[] };

export type UseFileSelectionInput = {
  currentSelectionScopeKey: string;
};

export type UseFileSelectionResult = {
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  selectedScopeKey: string;
  setSelectedScopeKey: (key: string) => void;
  batchAction: BatchAction;
  setBatchAction: (action: BatchAction) => void;
  progress: BatchProgress;
  setProgress: (next: BatchProgress) => void;
  moveTargetDir: string;
  setMoveTargetDir: (value: string) => void;
  moveProgress: BatchProgress;
  setMoveProgress: (next: BatchProgress) => void;
  selectedScopeMatches: boolean;
  toggleAll: (allFileIds: string[], allSelected: boolean) => void;
  toggleOne: (id: string) => void;
  clearSelection: () => void;
};

/**
 * Bulk-selection state for file lists.
 *
 * Tracks:
 *   - selectedIds (Set<string>) — ids of files the user has selected
 *   - selectedScopeKey — guards against stale selections when the
 *     visible file set changes (different folder / search query). When
 *     the key changes, the helper that derives "effectiveSelectedIds"
 *     treats the previous selection as if it were empty.
 *   - batchAction + progress + moveTargetDir — the in-flight batch
 *     operation (delete or move) state machine.
 *
 * `toggleAll` / `toggleOne` / `clearSelection` keep the scope key
 * current and reset transient batch state, matching the original
 * inline behavior in file-list-client.tsx.
 *
 * Extracted from file-list-client.tsx in R21.
 */
export function useFileSelection({
  currentSelectionScopeKey,
}: UseFileSelectionInput): UseFileSelectionResult {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedScopeKey, setSelectedScopeKey] = useState(
    () => currentSelectionScopeKey,
  );
  const [batchAction, setBatchAction] = useState<BatchAction>("none");
  const [progress, setProgress] = useState<BatchProgress>({
    done: 0,
    total: 0,
    errors: [],
  });
  const [moveTargetDir, setMoveTargetDir] = useState("");
  const [moveProgress, setMoveProgress] = useState<BatchProgress>({
    done: 0,
    total: 0,
    errors: [],
  });

  const selectedScopeMatches = selectedScopeKey === currentSelectionScopeKey;

  const resetTransient = useCallback(() => {
    setBatchAction("none");
    setMoveTargetDir("");
    setProgress({ done: 0, total: 0, errors: [] });
    setMoveProgress({ done: 0, total: 0, errors: [] });
  }, []);

  const toggleAll = useCallback(
    (allFileIds: string[], allSelected: boolean) => {
      setSelectedScopeKey(currentSelectionScopeKey);
      resetTransient();
      setSelectedIds(allSelected ? new Set() : new Set(allFileIds));
    },
    [currentSelectionScopeKey, resetTransient],
  );

  const toggleOne = useCallback(
    (id: string) => {
      setSelectedScopeKey(currentSelectionScopeKey);
      resetTransient();
      setSelectedIds((prev) => {
        const base = selectedScopeMatches ? prev : new Set<string>();
        const next = new Set(base);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    },
    [currentSelectionScopeKey, selectedScopeMatches, resetTransient],
  );

  const clearSelection = useCallback(() => {
    setSelectedScopeKey(currentSelectionScopeKey);
    setSelectedIds(new Set());
    resetTransient();
  }, [currentSelectionScopeKey, resetTransient]);

  return {
    selectedIds,
    setSelectedIds,
    selectedScopeKey,
    setSelectedScopeKey,
    batchAction,
    setBatchAction,
    progress,
    setProgress,
    moveTargetDir,
    setMoveTargetDir,
    moveProgress,
    setMoveProgress,
    selectedScopeMatches,
    toggleAll,
    toggleOne,
    clearSelection,
  };
}
