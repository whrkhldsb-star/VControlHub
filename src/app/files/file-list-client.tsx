"use client";

/**
 * FileListClient — the entry area of the drive: list or grid of the current
 * folder, selection with its action bar, the right-click menu, drag-to-folder
 * moves, the details drawer and the image viewer.
 *
 * Selection rules (unchanged from the dense table it replaces): only entries
 * the viewer may change are selectable; a selection belongs to one
 * folder/search scope and survives paging within it; batch actions act on the
 * entries the server said the viewer may change.
 */
import { useState, useCallback, useMemo, useTransition, useEffect, useRef, type MouseEvent } from "react";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/use-locale";
import { getStorageDriverLabel } from "@/lib/i18n/domain-labels";
import { ActionButton } from "@/components/action-button";
import { Copy, Download, FolderInput, Trash2, X } from "@/components/icons";
import { IconArchive } from "@/components/nav-icons";
import { useToast } from "@/components/toast-provider";
import { Dialog } from "@/components/ui/dialog";
import { AnchoredMenu } from "@/components/ui/menu";
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
import { useViewMode } from "./use-view-mode";
import { useBatchCompress } from "./use-file-batch-operations";
import { FileDetailPanelLazy } from "./file-detail-panel-lazy";
import {
  buildArchiveDownloadHref,
  buildForcedDownloadHref,
  buildSearchHref,
  containingFolderPath,
  formatEntryDay,
  formatEntryTime,
  getPreviewActionCopy,
  getPreviewHref,
  getThumbnailUrl,
  toStorageEntry,
  type FileProp,
} from "./file-entry-utils";
import { getFileKind } from "./file-entry-icons";
import { FileActionsProvider, useFileActions, type FileActionTarget } from "./file-actions";
import { EntryMenuItems, fileActionTarget, folderActionTarget, triggerDownload, type EntryMenuModel } from "./file-entry-menu";
import { FileGridView, FileListView, type DriveRow, type DriveRowHandlers } from "./file-list-views";
import { FileListEmptyState } from "./file-list-empty-state";
import { ImageLightbox } from "./image-lightbox";
import { recordFileOpen } from "./file-preferences-client";
import { submitFileOperation } from "./file-operation-controls";

export type { FileProp } from "./file-entry-utils";
export type { FolderProp } from "./file-list-model";

/** Archives /api/files/extract unpacks into a new folder (single-file .gz stays in the preview page). */
const EXTRACTABLE_ARCHIVE = /\.(zip|jar|tar|tgz|tar\.gz)$/i;

type FileListClientProps = {
  folders: FolderProp[];
  files: FileProp[];
  canEditLocalFiles: boolean;
  canDelete: boolean;
  canShare?: boolean;
  currentPath: string;
  searchQuery: string;
  /** The node the listing is filtered to; folder links carry it. */
  nodeIdFilter?: string;
  /** Show the storage node of each entry (all-nodes and search listings). */
  showSource?: boolean;
  /** Storage nodes, to show node roots as locations rather than folders. */
  nodes?: Array<{ id: string; name: string; driver: string; teamName?: string | null }>;
  selectionScopeSeed?: string;
  selectionPage?: number;
  onFolderClick?: (path: string) => void;
  onRefresh?: () => void;
  serverSort?: {key:FileListSortKey;dir:FileListSortDir;onChange:(key:FileListSortKey,dir:FileListSortDir) => void};
};

export function FileListClient(props: FileListClientProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { addToast: showToast } = useToast();
  const {
    folders,
    files,
    canEditLocalFiles,
    canDelete,
    currentPath,
    searchQuery,
    selectionScopeSeed,
    selectionPage,
    onRefresh,
  } = props;

  const capabilityFallbacks = useMemo(
    () => ({ canEditLocalFiles, canDelete }),
    [canEditLocalFiles, canDelete],
  );
  const visibleFiles = useMemo(() => getVisibleFiles(files), [files]);
  const currentSelectionScopeKey = selectionScopeSeed ?? `${currentPath}\u0000${searchQuery}`;

  // Directories are selectable too: the selection is a list of file entries.
  const selectionEntries = useMemo(() => [...visibleFiles, ...folders.flatMap((folder): FileProp[] => {
    const nodeId = folder.storageNodeId ?? (folder.sourceKeys.length === 1 ? folder.sourceKeys[0] : undefined);
    if (!folder.entryId || !nodeId) return [];
    return [{ id: folder.entryId, name: folder.name, entryType: "DIRECTORY", relativePath: folder.relativePath ?? folder.path,
      storageNodeId: nodeId, storageNodeName: folder.sourceValues[0] ?? "", storageNodeDriver: "", sizeLabel: "", previewable: false,
      directAccessMode: "", directAccessDescription: "", capabilities: folder.capabilities, favorite: folder.favorite }];
  })], [visibleFiles, folders]);
  const selectableFiles = useMemo(() => getSelectableFiles(selectionEntries, capabilityFallbacks), [selectionEntries, capabilityFallbacks]);

  const selection = useFileSelection({ currentSelectionScopeKey });
  const { selectedIds, setSelectedIds, setSelectedScopeKey, selectedScopeMatches, toggleAll: toggleAllRaw, toggleOne, clearSelection } = selection;
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
    () => getSelectionSummary({
      visibleFiles: selectionEntries,
      knownFiles,
      selectableFiles,
      selectedIds,
      selectedScopeMatches,
      fallbacks: capabilityFallbacks,
    }),
    [selectionEntries, knownFiles, selectableFiles, selectedIds, selectedScopeMatches, capabilityFallbacks],
  );

  return (
    <FileActionsProvider onChanged={onRefresh} onCleared={clearSelection}>
      <FileListBody
        {...props}
        t={t}
        router={router}
        showToast={showToast}
        visibleFiles={visibleFiles}
        knownFiles={knownFiles}
        selection={selection}
        selectionSummary={selectionSummary}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        setSelectedScopeKey={setSelectedScopeKey}
        toggleAllRaw={toggleAllRaw}
        toggleOne={toggleOne}
        clearSelection={clearSelection}
        currentSelectionScopeKey={currentSelectionScopeKey}
      />
    </FileActionsProvider>
  );
}

type BodyProps = FileListClientProps & {
  t: ReturnType<typeof useI18n>["t"];
  router: ReturnType<typeof useRouter>;
  showToast: ReturnType<typeof useToast>["addToast"];
  visibleFiles: FileProp[];
  knownFiles: FileProp[];
  selection: ReturnType<typeof useFileSelection>;
  selectionSummary: ReturnType<typeof getSelectionSummary>;
  selectedIds: Set<string>;
  setSelectedIds: (ids: Set<string>) => void;
  setSelectedScopeKey: (key: string) => void;
  toggleAllRaw: (ids: string[], allSelected: boolean) => void;
  toggleOne: (id: string) => void;
  clearSelection: () => void;
  currentSelectionScopeKey: string;
};

function FileListBody({
  folders,
  canEditLocalFiles,
  canDelete,
  canShare = false,
  currentPath,
  searchQuery,
  nodeIdFilter,
  showSource = false,
  nodes,
  onFolderClick,
  onRefresh,
  serverSort,
  t,
  router,
  showToast,
  visibleFiles,
  knownFiles,
  selection,
  selectionSummary,
  setSelectedIds,
  setSelectedScopeKey,
  toggleAllRaw,
  toggleOne,
  clearSelection,
  currentSelectionScopeKey,
}: BodyProps) {
  const actions = useFileActions();
  const { locale } = useI18n();
  const [viewMode] = useViewMode();
  const localSort = useFileListSort();
  const sortKey = serverSort?.key ?? localSort.sortKey;
  const sortDir = serverSort?.dir ?? localSort.sortDir;
  const toggleSort = (key: FileListSortKey) => {
    if (serverSort) serverSort.onChange(key, key === sortKey && sortDir === "asc" ? "desc" : "asc");
    else localSort.toggleSort(key);
  };
  const sortedFolders = useMemo(
    () => (serverSort ? folders : sortFolders(folders, sortKey, sortDir)),
    [folders, sortKey, sortDir, serverSort],
  );
  const sortedFiles = useMemo(
    () => (serverSort ? visibleFiles : sortFiles(visibleFiles, sortKey, sortDir)),
    [visibleFiles, sortKey, sortDir, serverSort],
  );

  const navigateToFolder = useCallback((path: string) => {
    const entryId = folders.find((folder) => folder.path === path)?.entryId;
    if (entryId) recordFileOpen(entryId);
    if (onFolderClick) onFolderClick(path);
    else router.push(buildSearchHref(path), { scroll: false });
  }, [onFolderClick, router, folders]);

  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const detailEntry = useMemo(() => {
    const file = visibleFiles.find((item) => item.id === detailEntryId);
    return file ? toStorageEntry(file) : null;
  }, [detailEntryId, visibleFiles]);
  const [lightboxId, setLightboxId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ model: EntryMenuModel; label: string; point: { x: number; y: number } } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [dropMove, setDropMove] = useState<{ ids: string[]; path: string; requestId: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const anchorId = useRef<string | null>(null);

  const entryCanRead = useCallback((entry: { capabilities?: FileProp["capabilities"] }) => canReadEntry(entry), []);
  const entryCanWrite = useCallback((entry: { capabilities?: FileProp["capabilities"] }) => canWriteEntry(entry, { canEditLocalFiles }), [canEditLocalFiles]);
  const entryCanDelete = useCallback((entry: { capabilities?: FileProp["capabilities"] }) => canDeleteEntry(entry, { canDelete }), [canDelete]);

  const { effectiveSelectedIds, effectiveSelectedIdSet, selectedCount, selectedFileEntries } = selectionSummary;
  const allFileIds = selectionSummary.selectableFileIds;

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
    setBatchAction: selection.setBatchAction,
    setProgress: selection.setProgress,
    setSelectedIds,
    setSelectedScopeKey,
    startTransition,
  });

  // Images of this page, in display order, for the viewer's previous / next.
  const images = useMemo(() => sortedFiles.filter((file) => {
    const entry = toStorageEntry(file);
    return getFileKind(file) === "image" && entry.previewable && canReadEntry(file);
  }), [sortedFiles]);

  // Name the customer only when locations belong to more than one.
  const manyCustomers = new Set((nodes ?? []).map((item) => item.teamName).filter(Boolean)).size > 1;
  const folderRows = useMemo<DriveRow[]>(() => sortedFolders.map((folder) => {
    const target = folderActionTarget(folder);
    const canRead = entryCanRead(folder);
    const canWrite = canWriteFolder(folder, { canEditLocalFiles });
    const mayDelete = canDelete && entryCanDelete(folder);
    // The all-locations root lists each node as a folder; show it as the location it is.
    const node = !folder.relativePath && !folder.storageNodeId && folder.sourceKeys.length === 1
      ? nodes?.find((item) => item.id === folder.sourceKeys[0])
      : undefined;
    const name = node?.name ?? folder.displayName ?? folder.name;
    const archiveHref = target ? buildArchiveDownloadHref({ storageNodeId: folder.storageNodeId, relativePath: folder.relativePath }) : null;
    const open = () => navigateToFolder(folder.path);
    return {
      key: `folder:${folder.path}`,
      kind: "folder",
      id: folder.entryId ?? null,
      name,
      detail: node ? ((manyCustomers && node.teamName) || getStorageDriverLabel(t, node.driver)) : undefined,
      nodeDriver: node?.driver,
      // The index only knows folders that were opened, so a count would say
      // "0 items" for a full folder never visited; show none, like desktop drives.
      sizeLabel: "—",
      modifiedLabel: "—",
      // The listing labels sources "name (DRIVER)"; say the node's name like file rows do.
      sourceLabel: node
        ? getStorageDriverLabel(t, node.driver)
        : nodes?.find((item) => item.id === (folder.storageNodeId ?? folder.sourceKeys[0]))?.name ?? folder.sourceValues[0],
      favorite: Boolean(folder.favorite),
      icon: { entryType: "DIRECTORY", name },
      thumbUrl: null,
      openHref: buildSearchHref(folder.path, nodeIdFilter ? { nodeId: nodeIdFilter } : undefined),
      onOpen: open,
      selectable: Boolean(target) && (entryCanWrite(folder) || entryCanDelete(folder)),
      selected: Boolean(folder.entryId && effectiveSelectedIdSet.has(folder.entryId)),
      draggable: Boolean(target) && entryCanWrite(folder),
      // The move runs on the node, so it needs the folder's path there. In
      // the all-locations search `path` is the browsing path ("Node__id/dir"),
      // and the move created that virtual prefix as a real folder.
      dropPath: target && entryCanWrite(folder) ? folder.relativePath ?? folder.path : undefined,
      nodeId: folder.storageNodeId ?? folder.sourceKeys[0],
      menu: { kind: "folder", target, canRead, canWrite, canDelete: mayDelete, canShare: false, openLabel: t("fileListClient.open"), onOpen: open, downloadHref: canRead ? archiveHref : null },
      downloadHref: canRead ? archiveHref : null,
    } satisfies DriveRow;
  }), [sortedFolders, entryCanRead, entryCanWrite, entryCanDelete, canEditLocalFiles, canDelete, navigateToFolder, nodeIdFilter, nodes, manyCustomers, effectiveSelectedIdSet, t]);

  const fileRows = useMemo<DriveRow[]>(() => sortedFiles.map((file) => {
    const entry = toStorageEntry(file);
    const target = fileActionTarget(file);
    const canRead = entryCanRead(file);
    const canWrite = entryCanWrite(file);
    const mayDelete = canDelete && entryCanDelete(file);
    const previewHref = entry.previewable && canRead ? getPreviewHref(entry) : null;
    const isImage = Boolean(previewHref) && getFileKind(file) === "image";
    const openDetails = () => {
      recordFileOpen(file.id);
      setDetailEntryId(file.id);
    };
    const open = isImage
      ? () => { recordFileOpen(file.id); setLightboxId(file.id); }
      : previewHref
        ? () => { recordFileOpen(file.id); router.push(previewHref); }
        : openDetails;
    const downloadHref = canRead ? buildForcedDownloadHref(entry) : null;
    const folderPath = containingFolderPath(file.relativePath);
    const previewCopy = getPreviewActionCopy(entry, t);
    return {
      key: `file:${file.id}`,
      kind: "file",
      id: file.id,
      name: file.name,
      detail: searchQuery ? `/${folderPath}` : undefined,
      sizeLabel: file.sizeLabel,
      modifiedLabel: formatEntryTime(file.updatedAt, locale),
      modifiedDay: formatEntryDay(file.updatedAt, locale),
      sourceLabel: file.storageNodeName,
      favorite: Boolean(file.favorite),
      icon: { entryType: file.entryType, mimeType: file.mimeType, name: file.name },
      thumbUrl: canRead ? getThumbnailUrl(entry) : null,
      openHref: previewHref,
      onOpen: open,
      selectable: canWrite || entryCanDelete(file),
      selected: effectiveSelectedIdSet.has(file.id),
      draggable: canWrite,
      nodeId: file.storageNodeId,
      menu: {
        kind: "file",
        target,
        canRead,
        canWrite,
        canDelete: mayDelete,
        canShare,
        openLabel: previewHref ? t("filesPage.preview.defaultTitle") : undefined,
        openDescription: previewHref && previewCopy.title !== t("filesPage.preview.defaultTitle") ? previewCopy.title : undefined,
        onOpen: open,
        downloadHref,
        onDetails: openDetails,
        extractable: canWrite && file.storageNodeDriver === "LOCAL" && EXTRACTABLE_ARCHIVE.test(file.name),
      },
      downloadHref,
      onShare: canShare && canRead ? () => actions.share(target) : undefined,
    } satisfies DriveRow;
  }), [sortedFiles, entryCanRead, entryCanWrite, entryCanDelete, canDelete, canShare, searchQuery, effectiveSelectedIdSet, router, actions, locale, t]);

  const rows = useMemo(() => [...folderRows, ...fileRows], [folderRows, fileRows]);
  const selectableOrder = useMemo(() => rows.filter((row) => row.selectable && row.id).map((row) => row.id!), [rows]);

  const allSelected = selectionSummary.allSelected;
  const toggleAll = useCallback(() => {
    toggleAllRaw(allFileIds, allSelected);
  }, [toggleAllRaw, allFileIds, allSelected]);

  const handlers = useMemo<DriveRowHandlers>(() => ({
    onToggle: (row) => {
      if (!row.id) return;
      anchorId.current = row.id;
      toggleOne(row.id);
    },
    onRowClick: (row, event) => {
      if (!row.id || !row.selectable) return;
      if (event.metaKey || event.ctrlKey) {
        anchorId.current = row.id;
        toggleOne(row.id);
        return;
      }
      if (event.shiftKey && anchorId.current && selectableOrder.includes(anchorId.current)) {
        const from = selectableOrder.indexOf(anchorId.current);
        const to = selectableOrder.indexOf(row.id);
        const range = selectableOrder.slice(Math.min(from, to), Math.max(from, to) + 1);
        setSelectedScopeKey(currentSelectionScopeKey);
        setSelectedIds(new Set([...effectiveSelectedIds, ...range].slice(0, 1000)));
        return;
      }
      anchorId.current = row.id;
      setSelectedScopeKey(currentSelectionScopeKey);
      setSelectedIds(new Set([row.id]));
    },
    onContextMenu: (row, event: MouseEvent) => {
      event.preventDefault();
      setContextMenu({ model: row.menu, label: `${t("fileMoreActions.more")} ${row.name}`, point: { x: event.clientX, y: event.clientY } });
    },
  }), [toggleOne, selectableOrder, setSelectedIds, setSelectedScopeKey, currentSelectionScopeKey, effectiveSelectedIds, t]);

  const selectedTargets = useMemo<FileActionTarget[]>(() => selectedFileEntries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    entryType: entry.entryType === "DIRECTORY" ? "DIRECTORY" : "FILE",
    relativePath: entry.relativePath,
    storageNodeId: entry.storageNodeId,
    storageNodeName: entry.storageNodeName,
    favorite: entry.favorite,
  })), [selectedFileEntries]);
  const singleNode = new Set(selectedTargets.map((target) => target.storageNodeId)).size === 1;
  const selectionReadable = selectedFileEntries.every((entry) => canReadEntry(entry));
  const singleFile = selectedFileEntries.length === 1 && selectedFileEntries[0]!.entryType !== "DIRECTORY" ? selectedFileEntries[0]! : null;

  // Selection shortcuts belong to the focused list, never to an open dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editing = target?.closest('input:not([type="checkbox"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
      if (editing || event.defaultPrevented || event.isComposing || event.altKey || isPending) return;
      if (!listRef.current?.contains(target) || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        toggleAllRaw(allFileIds, false);
      } else if (event.key === "Escape" && selectedCount > 0) {
        event.preventDefault();
        clearSelection();
      } else if ((event.key === "Delete" || (event.key === "Backspace" && event.metaKey)) && selectedCount > 0 && canDelete && selectionSummary.selectedEntriesCanDelete) {
        event.preventDefault();
        actions.remove(selectedTargets);
      } else if (event.key === "F2" && selectedTargets.length === 1 && selectionSummary.selectedEntriesCanMove) {
        event.preventDefault();
        actions.rename(selectedTargets[0]!);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleAllRaw, allFileIds, selectedCount, clearSelection, isPending, canDelete, selectionSummary, selectedTargets, actions]);

  const parentPath = useMemo(() => getParentPath(currentPath), [currentPath]);
  const emptyMessage = searchQuery
    ? t("fileListClient.searchEmpty", { query: searchQuery })
    : t("fileListClient.emptyFolder");
  const empty = (
    <FileListEmptyState
      emptyMessage={emptyMessage}
      onGoUp={parentPath !== null ? () => navigateToFolder(parentPath) : undefined}
    />
  );

  const batchBusy = isPending || selection.batchAction === "compressing";
  const selectionBar = selectedCount > 0 ? (
    <div role="region" aria-label={t("filesPage.batchToolbar.regionTitle")} className="flex min-w-0 flex-wrap items-center gap-1.5 py-1.5">
      <ActionButton size="sm" variant="ghost" square aria-label={t("filesPage.batchToolbar.clearSelection")} title={t("filesPage.batchToolbar.clearSelection")} onClick={clearSelection}>
        <X aria-hidden />
      </ActionButton>
      <span className="mr-1 text-sm font-medium text-[var(--text-primary)]">{t("filesPage.batchToolbar.selectedCount", { count: selectedCount })}</span>
      {singleFile && canReadEntry(singleFile) ? (
        <ActionButton size="sm" variant="ghost" icon={<Download aria-hidden />} onClick={() => triggerDownload(buildForcedDownloadHref(toStorageEntry(singleFile)))}>
          {t("fileListClient.downloadTitle")}
        </ActionButton>
      ) : null}
      {selectionSummary.selectedEntriesCanMove && singleNode ? (
        <ActionButton size="sm" variant="ghost" icon={<FolderInput aria-hidden />} disabled={batchBusy} onClick={() => actions.move(selectedTargets)}>
          {t("filesPage.drive.moveToEllipsis")}
        </ActionButton>
      ) : null}
      {selectionSummary.selectedEntriesCanMove && singleNode && selectionReadable ? (
        <ActionButton size="sm" variant="ghost" icon={<Copy aria-hidden />} disabled={batchBusy} onClick={() => actions.copy(selectedTargets)}>
          {t("filesPage.drive.copyToEllipsis")}
        </ActionButton>
      ) : null}
      {selectionSummary.selectedEntriesCanCompress ? (
        <ActionButton size="sm" variant="ghost" icon={<IconArchive size={16} aria-hidden />} loading={selection.batchAction === "compressing"} disabled={batchBusy} onClick={handleBatchCompress}>
          {selection.batchAction === "compressing" ? t("filesPage.batchToolbar.compressing") : t("filesPage.drive.compress")}
        </ActionButton>
      ) : null}
      {canDelete && selectionSummary.selectedEntriesCanDelete ? (
        <ActionButton size="sm" variant="danger" icon={<Trash2 aria-hidden />} disabled={batchBusy} onClick={() => actions.remove(selectedTargets)}>
          {t("common.delete")}
        </ActionButton>
      ) : null}
    </div>
  ) : undefined;

  const lightboxIndex = lightboxId ? images.findIndex((file) => file.id === lightboxId) : -1;

  return (
    <>
      <div
        ref={listRef}
        data-file-list
        tabIndex={-1}
        className="min-w-0 outline-none"
        onDragStartCapture={(event) => {
          const row = (event.target as HTMLElement).closest<HTMLElement>("[data-file-entry-id]");
          if (!row?.dataset.fileEntryId || isPending) { event.preventDefault(); return; }
          const ids = effectiveSelectedIdSet.has(row.dataset.fileEntryId) ? effectiveSelectedIds : [row.dataset.fileEntryId];
          const entries = knownFiles.filter((entry) => ids.includes(entry.id));
          if (entries.length !== ids.length || entries.some((entry) => !entryCanWrite(entry))) { event.preventDefault(); return; }
          event.dataTransfer.setData("application/x-vcontrolhub-files", JSON.stringify({ ids, nodeIds: [...new Set(entries.map((entry) => entry.storageNodeId))] }));
          event.dataTransfer.effectAllowed = "move";
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("application/x-vcontrolhub-files") && (event.target as HTMLElement).closest("[data-file-drop-path]")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("application/x-vcontrolhub-files")) return;
          event.preventDefault();
          event.stopPropagation();
          const folder = (event.target as HTMLElement).closest<HTMLElement>("[data-file-drop-path]");
          if (!folder || isPending) return;
          try {
            const payload = JSON.parse(event.dataTransfer.getData("application/x-vcontrolhub-files")) as { ids: string[]; nodeIds: string[] };
            if (!Array.isArray(payload.ids) || !payload.ids.length || payload.ids.length > 1000 || payload.ids.some((id) => typeof id !== "string") || payload.nodeIds.length !== 1 || payload.nodeIds[0] !== folder.dataset.fileNodeId) throw new Error(t("fileOperations.sameNode"));
            if (payload.ids.includes(folder.dataset.fileEntryId ?? "")) return;
            setDropMove({ ids: payload.ids, path: folder.dataset.fileDropPath!, requestId: crypto.randomUUID() });
          } catch (error) {
            showToast("error", error instanceof Error ? error.message : t("filePreferences.failed"));
          }
        }}
      >
        {viewMode === "grid" ? (
          <FileGridView rows={rows} handlers={handlers} empty={empty} selectionBar={selectionBar} />
        ) : (
          <FileListView
            rows={rows}
            handlers={handlers}
            empty={empty}
            showSource={showSource}
            header={{
              allSelected,
              someSelected: selectionSummary.someSelected,
              selectableCount: allFileIds.length,
              onToggleAll: toggleAll,
              sortKey,
              sortDir,
              onSort: toggleSort,
              selectionBar,
            }}
          />
        )}
      </div>

      <AnchoredMenu
        anchor={contextMenu ? contextMenu.point : null}
        label={contextMenu?.label ?? ""}
        onClose={() => setContextMenu(null)}
      >
        {contextMenu ? <EntryMenuItems model={contextMenu.model} /> : null}
      </AnchoredMenu>

      <Dialog
        size="sm"
        open={dropMove !== null}
        busy={isPending}
        onClose={() => setDropMove(null)}
        title={t("fileOperations.move")}
        footer={<>
          <ActionButton variant="secondary" disabled={isPending} onClick={() => setDropMove(null)}>{t("common.cancel")}</ActionButton>
          <ActionButton loading={isPending} onClick={() => {
            if (!dropMove) return;
            const target = dropMove;
            startTransition(async () => {
              try {
                await submitFileOperation({ action: "move", fileEntryIds: target.ids, targetDir: target.path, policy: "skip" }, target.requestId);
                setDropMove(null);
                clearSelection();
                showToast("info", t("fileOperations.queued"));
              } catch (error) {
                showToast("error", error instanceof Error ? error.message : t("filePreferences.failed"));
              }
            });
          }}>{t("common.confirm")}</ActionButton>
        </>}
      >
        <p className="break-all text-sm text-[var(--text-secondary)]">{t("fileOperations.confirmDrop", { count: dropMove?.ids.length ?? 0, path: dropMove?.path ?? "" })}</p>
      </Dialog>

      {detailEntry ? (
        <FileDetailPanelLazy
          detailEntry={detailEntry}
          favorite={Boolean(visibleFiles.find((file) => file.id === detailEntry.id)?.favorite)}
          onClose={() => setDetailEntryId(null)}
          canShare={canShare}
          canDelete={canDelete}
          onRefresh={onRefresh}
          onNotify={showToast}
          entryCanRead={entryCanRead}
          entryCanWrite={entryCanWrite}
          entryCanDelete={entryCanDelete}
        />
      ) : null}

      {lightboxIndex >= 0 ? (
        <ImageLightbox
          images={images}
          index={lightboxIndex}
          onIndexChange={(next) => setLightboxId(images[next]?.id ?? null)}
          onClose={() => setLightboxId(null)}
          onDetails={(id) => {
            setLightboxId(null);
            setDetailEntryId(id);
          }}
        />
      ) : null}
    </>
  );
}
