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
import { useState, useCallback, useMemo, useTransition, useEffect, useRef } from "react";
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
  type FileListSortKey,
  type FileListSortDir,
} from "./file-list-model";
import { getParentPath } from "./files-browser-helpers";
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
import { recordFileOpen } from "./file-preferences-client";
import { submitFileOperation } from "./file-operation-controls";
import { ModalShell } from "@/components/modal-shell";
import { ActionButton } from "@/components/action-button";

type FileListClientProps = {
  folders: FolderProp[];
  files: FileProp[];
  canEditLocalFiles: boolean;
  canDelete: boolean;
  canShare?: boolean;
  currentPath: string;
  searchQuery: string;
  selectionScopeSeed?: string;
  selectionPage?: number;
  onFolderClick?: (path: string) => void;
  onRefresh?: () => void;
  serverSort?: {key:FileListSortKey;dir:FileListSortDir;onChange:(key:FileListSortKey,dir:FileListSortDir) => void};
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
  selectionPage,
  onFolderClick,
  onRefresh,
  serverSort,
}: FileListClientProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { toasts, showToast, dismissToast } = useFileToast();

  const navigateToFolder = useCallback(
    (path: string) => {
      const entryId = folders.find((folder) => folder.path === path)?.entryId;
      if (entryId) recordFileOpen(entryId);
      if (onFolderClick) {
        onFolderClick(path);
      } else {
        router.push(buildSearchHref(path), { scroll: false });
      }
    },
    [onFolderClick, router, folders],
  );

  const [viewMode, handleViewModeChange] = useViewMode();
  const localSort = useFileListSort();
  const sortKey = serverSort?.key ?? localSort.sortKey;
  const sortDir = serverSort?.dir ?? localSort.sortDir;
  const toggleSort = (key:FileListSortKey) => {
    if (serverSort) serverSort.onChange(key,key === sortKey && sortDir === "asc" ? "desc" : "asc");
    else localSort.toggleSort(key);
  };

  const capabilityFallbacks = useMemo(
    () => ({ canEditLocalFiles, canDelete }),
    [canEditLocalFiles, canDelete],
  );
  const sortedFolders = useMemo(
    () => serverSort ? folders : sortFolders(folders, sortKey, sortDir),
    [folders, sortKey, sortDir, serverSort],
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
  const selectionEntries = useMemo(() => [...visibleFiles, ...folders.flatMap((folder): FileProp[] => {
    const nodeId = folder.storageNodeId ?? (folder.sourceKeys.length === 1 ? folder.sourceKeys[0] : undefined);
    if (!folder.entryId || !nodeId) return [];
    return [{ id: folder.entryId, name: folder.name, entryType: "DIRECTORY", relativePath: folder.relativePath ?? folder.path,
      storageNodeId: nodeId, storageNodeName: folder.sourceValues[0] ?? "", storageNodeDriver: "", sizeLabel: "", previewable: false,
      directAccessMode: "", directAccessDescription: "", capabilities: folder.capabilities }];
  })], [visibleFiles, folders]);
  const selectableFiles = useMemo(() => getSelectableFiles(selectionEntries, capabilityFallbacks), [selectionEntries, capabilityFallbacks]);
  const folderCanWrite = useCallback(
    (folder: FolderProp) => canWriteFolder(folder, { canEditLocalFiles }),
    [canEditLocalFiles],
  );

  const sortedFiles = useMemo(
    () => serverSort ? visibleFiles : sortFiles(visibleFiles, sortKey, sortDir),
    [visibleFiles, sortKey, sortDir, serverSort],
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
  const [dropMove, setDropMove] = useState<{ ids: string[]; path: string; requestId: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [selectionCache, setSelectionCache] = useState(() => ({ scope: currentSelectionScopeKey, page: selectionPage, visible: selectionEntries, entries: selectionEntries }));
  let knownFiles = selectionCache.entries;
  if (selectionCache.scope !== currentSelectionScopeKey || selectionCache.visible !== selectionEntries || selectionCache.page !== selectionPage) {
    const oldVisibleIds = new Set(selectionCache.visible.map((file) => file.id));
    const retained = selectionCache.scope === currentSelectionScopeKey && selectionPage !== undefined
      ? selectionCache.entries.filter((file) => selectedIds.has(file.id) && (selectionCache.page !== selectionPage || !oldVisibleIds.has(file.id))) : [];
    knownFiles = [...new Map([...retained, ...selectionEntries].map((file) => [file.id, file])).values()];
    setSelectionCache({ scope: currentSelectionScopeKey, page: selectionPage, visible: selectionEntries, entries: knownFiles });
  }

  const selectionSummary = useMemo(
    () =>
      getSelectionSummary({
        visibleFiles: selectionEntries,
        knownFiles,
        selectableFiles,
        selectedIds,
        selectedScopeMatches,
        fallbacks: capabilityFallbacks,
      }),
    [
      selectionEntries,
      knownFiles,
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
  const selectedEntriesCanCompress = selectionSummary.selectedEntriesCanCompress;
  const allSelected = selectionSummary.allSelected;
  const someSelected = selectionSummary.someSelected;

  const toggleAll = useCallback(() => {
    toggleAllRaw(allFileIds, allSelected);
  }, [toggleAllRaw, allFileIds, allSelected]);

  // Selection shortcuts belong to the focused list, never to an open dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
      if (editing || event.defaultPrevented || event.isComposing || event.altKey || isPending || batchAction !== "none") return;
      if (!listRef.current?.contains(target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        toggleAllRaw(allFileIds, false);
      } else if (event.key === "Escape" && selectedCount > 0) {
        event.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleAllRaw, allFileIds, selectedCount, clearSelection, isPending, batchAction]);

  const handleBatchDelete = useBatchDelete({
    background: true,
    effectiveSelectedIds,
    files: knownFiles,
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
  });

  const submitBatchMove = useBatchMove({
    background: true,
    effectiveSelectedIds,
    moveTargetDir,
    files: knownFiles,
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
  });

  const handleBatchCompress = useBatchCompress({
    effectiveSelectedIds,
    files: knownFiles,
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
  });

  const emptyMessage = searchQuery
    ? t("fileListClient.searchEmpty", { query: searchQuery })
    : t("fileListClient.emptyFolder");
  const parentPath = useMemo(() => getParentPath(currentPath), [currentPath]);
  const goToParent = useCallback(() => {
    if (parentPath === null) return;
    navigateToFolder(parentPath);
  }, [navigateToFolder, parentPath]);

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
    parentPath,
    onGoUp: parentPath !== null ? goToParent : undefined,
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

      <div ref={listRef} data-file-list tabIndex={0} className="mt-6 overflow-x-auto rounded-2xl border border-[var(--border)]"
        onClickCapture={(event) => {
          const target = event.target as HTMLElement;
          if (!target.closest("a[href]")) return;
          const entryId = target.closest<HTMLElement>("[data-file-entry-id]")?.dataset.fileEntryId;
          if (entryId) recordFileOpen(entryId);
        }}
        onDragStartCapture={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>("[data-file-entry-id]");
          if (!row?.dataset.fileEntryId || isPending || batchAction !== "none") { event.preventDefault(); return; }
          const ids = effectiveSelectedIdSet.has(row.dataset.fileEntryId) ? effectiveSelectedIds : [row.dataset.fileEntryId];
          const entries = knownFiles.filter((entry) => ids.includes(entry.id));
          if (entries.length !== ids.length || entries.some((entry) => !entryCanWrite(entry))) { event.preventDefault(); return; }
          event.dataTransfer.setData("application/x-vcontrolhub-files", JSON.stringify({ ids, nodeIds: [...new Set(entries.map((entry) => entry.storageNodeId))] }));
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-vcontrolhub-files") && (event.target as HTMLElement).closest("[data-file-drop-path]")) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("application/x-vcontrolhub-files")) return;
          event.preventDefault(); event.stopPropagation();
          const folder = (event.target as HTMLElement).closest<HTMLElement>("[data-file-drop-path]");
          if (!folder || isPending) return;
          try {
            const payload = JSON.parse(event.dataTransfer.getData("application/x-vcontrolhub-files")) as { ids: string[]; nodeIds: string[] };
            if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 1000 || payload.ids.some((id) => typeof id !== "string") || payload.nodeIds.length !== 1 || payload.nodeIds[0] !== folder.dataset.fileNodeId) throw new Error(t("fileOperations.sameNode"));
            setDropMove({ ids: payload.ids, path: folder.dataset.fileDropPath!, requestId: crypto.randomUUID() });
          } catch (error) { showToast("error", error instanceof Error ? error.message : t("filePreferences.failed")); }
        }}>
        <FileListToolbar
          itemCount={sortedFolders.length + sortedFiles.length}
          selectedCount={selectedCount}
          viewMode={viewMode}
          onChangeViewMode={handleViewModeChange}
          onGoUp={parentPath !== null ? goToParent : undefined}
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
      <ModalShell open={dropMove !== null} busy={isPending} onClose={() => setDropMove(null)} label={t("fileOperations.move")}>
        <p className="break-all text-sm">{t("fileOperations.confirmDrop", { count: dropMove?.ids.length ?? 0, path: dropMove?.path ?? "" })}</p>
        <div className="mt-4 flex gap-3"><ActionButton disabled={isPending} onClick={() => { if (!dropMove) return; const target = dropMove; startTransition(async () => { try { await submitFileOperation({ action: "move", fileEntryIds: target.ids, targetDir: target.path, policy: "skip" }, target.requestId); setDropMove(null); clearSelection(); } catch (error) { showToast("error", error instanceof Error ? error.message : t("filePreferences.failed")); } }); }}>{t("common.confirm")}</ActionButton><ActionButton variant="outline" disabled={isPending} onClick={() => setDropMove(null)}>{t("common.cancel")}</ActionButton></div>
      </ModalShell>

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
        operationEntryIds={effectiveSelectedIds}
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
        selectedEntriesCanCompress={selectedEntriesCanCompress}
        selectedScopeMatches={selectedScopeMatches}
        currentPath={currentPath}
        moveNodeId={new Set(selectionSummary.selectedFileEntries.map((entry) => entry.storageNodeId)).size === 1
          ? selectionSummary.selectedFileEntries[0]?.storageNodeId : undefined}
        onClearSelection={clearSelection}
        onConfirmDelete={handleBatchDelete}
        onSubmitMove={submitBatchMove}
        onCompressSelected={handleBatchCompress}
      />
    </>
  );
}
