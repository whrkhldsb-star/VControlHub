"use client";

/**
 * FileListClient — orchestration shell for the file list.
 *
 * R31 split: the heavy lifting (per-view layout, batch ops, toolbar,
 * toasts, action helpers) moved to sibling files. This component now
 * wires hooks together and delegates rendering to:
 *
 *   - FileListToolbar       (view-mode switcher)
 *   - FileListListView      (list view, default)
 *   - FileListGridView      (grid view)
 *   - FileListDetailsView   (details view)
 *   - FileListToasts        (toast stack)
 *   - FileBatchToolbarLazy  (bottom batch action bar — unchanged)
 *   - FileDetailPanelLazy   (right-side detail panel — unchanged)
 *
 * Batch handlers live in `use-file-batch-operations`; selection state in
 * `use-file-selection`; toast state in `use-file-toast`. The component
 * itself is now ~200 lines of glue, which is what was needed for the
 * "Super-large client component split" item in the README.
 */
import { useState, useCallback, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/use-locale";

import {
  entryCanDelete as canDeleteEntry,
  entryCanRead as canReadEntry,
  entryCanWrite as canWriteEntry,
  folderCanWrite as canWriteFolder,
  getSelectableFiles,
  getSelectionSummary,
  getVisibleFiles,
  sortFiles,
  sortFolders,
  type FolderProp,
} from "./file-list-model";
import { useFileListSort } from "./use-file-list-sort";
import { useFileSelection } from "./use-file-selection";
import { useFileToast } from "./use-file-toast";
import { useViewMode } from "./use-view-mode";
import {
  useBatchCompress,
  useBatchDelete,
  useBatchMove,
} from "./use-file-batch-operations";
import { FileBatchToolbarLazy } from "./file-batch-toolbar-lazy";
import { FileDetailPanelLazy } from "./file-detail-panel-lazy";
import { FileListGridView } from "./file-list-grid-view";
import { FileListDetailsView } from "./file-list-details-view";
import { FileListListView } from "./file-list-list-view";
import { FileListToasts } from "./file-list-toasts";
import { FileListToolbar } from "./file-list-toolbar";
import {
  buildSearchHref,
  toStorageEntry,
  type FileProp,
} from "./file-entry-utils";

export type { FileProp } from "./file-entry-utils";
export type { FolderProp } from "./file-list-model";

type FileListClientProps = {
  folders: FolderProp[];
  files: FileProp[];
  canEditLocalFiles: boolean;
  canDelete: boolean;
  canShare?: boolean;
  currentPath: string;
  searchQuery: string;
  selectionScopeSeed?: string;
  onFolderClick?: (path: string) => void;
  onRefresh?: () => void;
};

export function FileListClient({
  folders,
  files,
  canEditLocalFiles,
  canDelete,
  canShare = false,
  currentPath,
  searchQuery,
  selectionScopeSeed,
  onFolderClick,
  onRefresh,
}: FileListClientProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { toasts, showToast, dismissToast } = useFileToast();

  const navigateToFolder = useCallback(
    (path: string) => {
      if (onFolderClick) {
        onFolderClick(path);
      } else {
        router.push(buildSearchHref(path), { scroll: false });
      }
    },
    [onFolderClick, router],
  );

  const [viewMode, handleViewModeChange] = useViewMode();
  const { sortKey, sortDir, toggleSort } = useFileListSort();

  const capabilityFallbacks = useMemo(
    () => ({ canEditLocalFiles, canDelete }),
    [canEditLocalFiles, canDelete],
  );
  const sortedFolders = useMemo(
    () => sortFolders(folders, sortKey, sortDir),
    [folders, sortKey, sortDir],
  );
  const visibleFiles = useMemo(() => getVisibleFiles(files), [files]);
  const currentSelectionScopeKey =
    selectionScopeSeed ?? `${currentPath}\u0000${searchQuery}`;

  const entryCanRead = useCallback(
    (entry: { capabilities?: FileProp["capabilities"] }) => canReadEntry(entry),
    [],
  );
  const entryCanWrite = useCallback(
    (entry: { capabilities?: FileProp["capabilities"] }) =>
      canWriteEntry(entry, { canEditLocalFiles }),
    [canEditLocalFiles],
  );
  const entryCanDelete = useCallback(
    (entry: { capabilities?: FileProp["capabilities"] }) =>
      canDeleteEntry(entry, { canDelete }),
    [canDelete],
  );
  const selectableFiles = useMemo(
    () => getSelectableFiles(visibleFiles, capabilityFallbacks),
    [visibleFiles, capabilityFallbacks],
  );
  const folderCanWrite = useCallback(
    (folder: FolderProp) => canWriteFolder(folder, { canEditLocalFiles }),
    [canEditLocalFiles],
  );

  const sortedFiles = useMemo(
    () => sortFiles(visibleFiles, sortKey, sortDir),
    [visibleFiles, sortKey, sortDir],
  );

  const {
    selectedIds,
    setSelectedIds,
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
    toggleAll: toggleAllRaw,
    toggleOne,
    clearSelection,
  } = useFileSelection({ currentSelectionScopeKey });
  const [isPending, startTransition] = useTransition();

  const selectionSummary = useMemo(
    () =>
      getSelectionSummary({
        visibleFiles,
        selectableFiles,
        selectedIds,
        selectedScopeMatches,
        fallbacks: capabilityFallbacks,
      }),
    [
      visibleFiles,
      selectableFiles,
      selectedIds,
      selectedScopeMatches,
      capabilityFallbacks,
    ],
  );
  const allFileIds = selectionSummary.selectableFileIds;
  const effectiveSelectedIds = selectionSummary.effectiveSelectedIds;
  const effectiveSelectedIdSet = selectionSummary.effectiveSelectedIdSet;
  const selectedCount = selectionSummary.selectedCount;
  const selectedEntriesCanDelete = selectionSummary.selectedEntriesCanDelete;
  const selectedEntriesCanMove = selectionSummary.selectedEntriesCanMove;
  const allSelected = selectionSummary.allSelected;
  const someSelected = selectionSummary.someSelected;

  const toggleAll = useCallback(() => {
    toggleAllRaw(allFileIds, allSelected);
  }, [toggleAllRaw, allFileIds, allSelected]);

  const handleBatchDelete = useBatchDelete({
    effectiveSelectedIds,
    files,
    router,
    clearSelection,
    onRefresh,
    currentSelectionScopeKey,
    showToast,
    setBatchAction,
    setProgress,
    setSelectedIds,
    setSelectedScopeKey,
    startTransition,
  });

  const submitBatchMove = useBatchMove({
    effectiveSelectedIds,
    moveTargetDir,
    files,
    router,
    clearSelection,
    onRefresh,
    currentSelectionScopeKey,
    showToast,
    setBatchAction,
    setMoveProgress,
    setSelectedIds,
    setSelectedScopeKey,
    startTransition,
  });

  const handleBatchCompress = useBatchCompress({
    effectiveSelectedIds,
    files,
    router,
    clearSelection,
    onRefresh,
    currentPath,
    currentSelectionScopeKey,
    showToast,
    setBatchAction,
    setProgress,
    setSelectedIds,
    setSelectedScopeKey,
    startTransition,
  });

  const emptyMessage = searchQuery
    ? t("fileListClient.searchEmpty").replace("{query}", searchQuery)
    : t("fileListClient.emptyFolder");

  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const detailEntry = useMemo(() => {
    const file = visibleFiles.find((item) => item.id === detailEntryId);
    return file ? toStorageEntry(file) : null;
  }, [detailEntryId, visibleFiles]);

  const closeDetail = useCallback(() => setDetailEntryId(null), []);

  // Shared per-view render props
  const sharedViewProps = {
    sortedFolders,
    sortedFiles,
    emptyMessage,
    effectiveSelectedIdSet,
    toggleOne,
    navigateToFolder,
    canShare,
    canDelete,
    onRefresh,
    onNotify: showToast,
    onOpenDetail: setDetailEntryId,
    entryCanRead,
    entryCanWrite,
    entryCanDelete,
  } as const;

  return (
    <>
      <FileListToasts toasts={toasts} onDismiss={dismissToast} />

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--border)]">
        <FileListToolbar
          itemCount={sortedFolders.length + sortedFiles.length}
          selectedCount={selectedCount}
          viewMode={viewMode}
          onChangeViewMode={handleViewModeChange}
        />

        {viewMode === "list" ? (
          <FileListListView
            {...sharedViewProps}
            visibleFilesCount={visibleFiles.length}
            allSelected={allSelected}
            someSelected={someSelected}
            toggleAll={toggleAll}
            sortKey={sortKey}
            sortDir={sortDir}
            toggleSort={toggleSort}
            folderCanWrite={folderCanWrite}
          />
        ) : viewMode === "grid" ? (
          <FileListGridView {...sharedViewProps} />
        ) : (
          <FileListDetailsView
            {...sharedViewProps}
            folderCanWrite={folderCanWrite}
          />
        )}
      </div>

      {detailEntry ? (
        <FileDetailPanelLazy
          detailEntry={detailEntry}
          onClose={closeDetail}
          canShare={canShare}
          canDelete={canDelete}
          onRefresh={onRefresh}
          onNotify={showToast}
          entryCanRead={entryCanRead}
          entryCanWrite={entryCanWrite}
          entryCanDelete={entryCanDelete}
        />
      ) : null}

      <FileBatchToolbarLazy
        selectedCount={selectedCount}
        batchAction={batchAction}
        setBatchAction={setBatchAction}
        progress={progress}
        moveProgress={moveProgress}
        moveTargetDir={moveTargetDir}
        setMoveTargetDir={setMoveTargetDir}
        setMoveProgress={setMoveProgress}
        isPending={isPending}
        canDelete={canDelete}
        selectedEntriesCanDelete={selectedEntriesCanDelete}
        selectedEntriesCanMove={selectedEntriesCanMove}
        selectedScopeMatches={selectedScopeMatches}
        currentPath={currentPath}
        onClearSelection={clearSelection}
        onConfirmDelete={handleBatchDelete}
        onSubmitMove={submitBatchMove}
        onCompressSelected={handleBatchCompress}
      />
    </>
  );
}
