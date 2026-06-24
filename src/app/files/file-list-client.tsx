"use client";

import { useState, useCallback, useTransition, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { useI18n } from "@/lib/i18n/use-locale";
import { deleteFileEntryAction } from "../storage/actions";
import { moveFileAction } from "./move-file-action";
import { FileBatchToolbarLazy } from "./file-batch-toolbar-lazy";
import { FileDetailPanelLazy } from "./file-detail-panel-lazy";
import { FileMoreActionsLazy } from "./file-more-actions-lazy";
import { RenameInlineForm, MoveInlineForm } from "./file-row-actions";
import { DownloadIcon, FileTypeIcon, PreviewIcon } from "./file-entry-icons";
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
import { SortIcon, useFileListSort } from "./use-file-list-sort";
import { useFileSelection } from "./use-file-selection";
import { useFileToast } from "./use-file-toast";
import { useViewMode } from "./use-view-mode";
import {
  buildArchiveDownloadHref,
  buildForcedDownloadHref,
  buildSearchHref,
  formatDate,
  getPreviewActionCopy,
  getPreviewHref,
  getThumbnailUrl,
  toStorageEntry,
  type FileProp,
  type StorageEntry,
} from "./file-entry-utils";

export type { FileProp } from "./file-entry-utils";
export type { FolderProp } from "./file-list-model";

/* ── component props ──────────────────────────────────────────────── */

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

/* ── view mode type imported from use-view-mode ─────────────────────── */
// (BatchProgress + FileToast types re-exported from use-file-selection /
// use-file-toast in R21 — replaced the previous inline duplicates.)

/* ── main component ───────────────────────────────────────────────── */

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

  /** Navigate to a folder path */
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

  /* ── view mode with localStorage persistence ────────────────────── */

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

  // SortIcon now lives in use-file-list-sort.tsx and is used directly below.

  // Selection state (list view only) — extracted to use-file-selection in R21
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

  const handleBatchDelete = useCallback(() => {
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
        showToast("success", `已删除 ${ids.length} 个文件`);
        clearSelection();
        return;
      }
      showToast("error", `批量删除完成，但有 ${errors.length} 个文件失败`);
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
    setBatchAction,
    setProgress,
    setSelectedIds,
    setSelectedScopeKey,
  ]);

  const submitBatchMove = useCallback(() => {
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
          errors.push(`${id}: 文件不存在`);
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
        showToast("success", `已移动 ${ids.length} 个文件`);
        clearSelection();
        return;
      }
      showToast("error", `批量移动完成，但有 ${errors.length} 个文件失败`);
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
    setBatchAction,
    setMoveProgress,
    setSelectedIds,
    setSelectedScopeKey,
  ]);

  const emptyMessage = searchQuery
    ? `未找到匹配 "${searchQuery}" 的文件。`
    : t("fileListClient.emptyFolder");

  const [detailEntryId, setDetailEntryId] = useState<string | null>(null);
  const detailEntry = useMemo(() => {
    const file = visibleFiles.find((item) => item.id === detailEntryId);
    return file ? toStorageEntry(file) : null;
  }, [detailEntryId, visibleFiles]);

  function renderDetailAction(entry: StorageEntry, compact = false) {
    return (
      <button
        type="button"
        title={t("fileListClient.detailTitle")}
        aria-label={`资料详情 ${entry.name}`}
        onClick={() => setDetailEntryId(entry.id)}
        className={
          compact
            ? "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-violet-400/30 bg-violet-500/10 text-violet-100 transition hover:bg-violet-500/20"
            : "inline-flex items-center gap-1.5 rounded-lg border border-violet-400/30 bg-violet-500/10 px-2.5 py-1.5 text-xs text-violet-100 transition hover:bg-violet-500/20"
        }
      >
        <svg
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M12 16v-4" />
          <path d="M12 8h.01" />
        </svg>
        {compact ? null : <span>详情</span>}
      </button>
    );
  }

  /* helper to render file actions for any view */
  function renderDownloadActions(
    entry: StorageEntry,
    downloadUrl: string,
    compact = false,
  ) {
    if (!entryCanRead(entry)) {
      return null;
    }

    return (
      <Link
        href={downloadUrl}
        title={t("fileListClient.downloadTitle")}
        aria-label={`下载 ${entry.name}`}
        download={downloadUrl.startsWith("/") ? true : undefined}
        target={downloadUrl.startsWith("/") ? undefined : "_blank"}
        rel={downloadUrl.startsWith("/") ? undefined : "noopener noreferrer"}
        className={
          compact
            ? "inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 hover:text-white"
            : "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-white/10 hover:text-white"
        }
      >
        <DownloadIcon />
        {compact ? null : <span>下载</span>}
      </Link>
    );
  }

  function renderFolderDownloadAction(folder: FolderProp, compact = false) {
    if (!entryCanRead(folder)) return null;
    const href = buildArchiveDownloadHref({
      storageNodeId: folder.storageNodeId ?? folder.sourceKeys[0],
      relativePath: folder.relativePath ?? folder.path,
    });
    if (!href) return null;
    return (
      <Link
        href={href}
        title={t("fileListClient.downloadFolderArchiveTitle")}
        aria-label={`下载目录 ${folder.displayName ?? folder.name}`}
        download
        className={
          compact
            ? "inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 hover:text-white"
            : "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10 hover:text-white"
        }
      >
        <DownloadIcon />
        {compact ? null : <span>下载</span>}
      </Link>
    );
  }

  /* helper to render file actions for any view */
  function renderFileActions(
    entry: StorageEntry,
    downloadUrl: string,
    previewHref: string,
    compact = false,
  ) {
    const previewAction = getPreviewActionCopy(entry);
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {renderDetailAction(entry, compact)}
        {entry.previewable && entryCanRead(entry) ? (
          <Link
            href={previewHref}
            title={previewAction.title}
            aria-label={previewAction.label}
            data-tone="cyan" className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-400/30 text-cyan-100 transition hover:bg-cyan-500/20"
          >
            <PreviewIcon />
          </Link>
        ) : null}
        {renderDownloadActions(entry, downloadUrl, true)}
        <FileMoreActionsLazy
          entry={entry}
          compact={compact}
          canShare={canShare}
          canDelete={canDelete}
          onRefresh={onRefresh}
          onNotify={showToast}
          entryCanRead={entryCanRead}
          entryCanWrite={entryCanWrite}
          entryCanDelete={entryCanDelete}
        />
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════ */
  /* ── GRID VIEW (redesigned — large icons, clear buttons) ──────── */
  /* ══════════════════════════════════════════════════════════════════ */

  function renderGridView() {
    return (
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {sortedFolders.length === 0 && sortedFiles.length === 0 ? (
          <div className="col-span-full py-16 text-center">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="mx-auto mb-3 text-slate-600"
            >
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <p className="text-sm text-slate-400">
              {emptyMessage}
            </p>
          </div>
        ) : null}

        {/* Folder cards */}
        {sortedFolders.map((folder) => (
          <button
            key={folder.path}
            type="button"
            onClick={() => navigateToFolder(folder.path)}
            data-testid="folder-card"
            className="group flex min-h-[156px] flex-col items-center gap-3 rounded-xl border border-white/[0.06] bg-slate-900/80 p-5 text-center transition-colors duration-150 hover:border-amber-400/30 hover:bg-amber-400/[0.04]"
          >
            <div
              className="rounded-xl bg-amber-400/10 p-3 transition-colors group-hover:bg-amber-400/20"
              aria-hidden="true"
            >
              <FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={36} />
            </div>
            <span className="w-full truncate text-sm font-medium text-cyan-100 group-hover:text-white light:hover:text-slate-900 transition">
              {folder.displayName ?? folder.name}
            </span>
            <span className="text-xs text-slate-500">
              {folder.fileCount + folder.folderCount} 项
            </span>
          </button>
        ))}

        {/* File cards */}
        {sortedFiles.map((fileProp) => {
          const entry = toStorageEntry(fileProp);
          const thumbUrl = getThumbnailUrl(entry);
          const downloadUrl = buildForcedDownloadHref(entry);
          const previewHref = getPreviewHref(entry);
          const isChecked = effectiveSelectedIdSet.has(fileProp.id);

          return (
            <div
              key={entry.id}
              className={`group relative flex flex-col rounded-2xl border border-white/[0.06] bg-slate-900/80 text-center transition-colors duration-200 hover:border-cyan-400/20 hover:shadow-lg hover:shadow-cyan-400/5 overflow-hidden ${isChecked ? "ring-2 ring-cyan-400/50 bg-cyan-400/[0.04] light:bg-cyan-50" : ""}`}
            >
              {/* Selection checkbox */}
              <div className="absolute top-2 left-2 z-20">
                {entryCanWrite(entry) || entryCanDelete(entry) ? (
                  <input
                    type="checkbox"
                    checked={effectiveSelectedIdSet.has(entry.id)}
                    onChange={() => toggleOne(entry.id)}
                    aria-label={`选择 ${entry.name}`}
                    className="h-4 w-4 rounded border-white/20 bg-slate-900 text-cyan-400 focus:ring-cyan-400/50"
                  />
                ) : null}
              </div>

              {/* Thumbnail / icon area */}
              <div className="relative flex items-center justify-center pt-6 pb-2 px-4">
                {thumbUrl ? (
                  <div
                    data-testid="file-thumbnail-overlay"
                    className="w-full h-28 rounded-xl overflow-hidden border border-white/[0.06]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={thumbUrl}
                      alt={entry.name}
                      width={224}
                      height={112}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </div>
                ) : (
                  <div className="rounded-xl bg-white/[0.03] p-4">
                    <FileTypeIcon entry={entry} size={44} />
                  </div>
                )}
              </div>

              {/* File name & meta */}
              <div className="px-4 pb-2 flex-1 flex flex-col">
                {entry.previewable && entryCanRead(entry) ? (
                  <Link
                    href={previewHref}
                    className="w-full truncate text-sm font-medium text-white hover:text-cyan-100 transition"
                  >
                    {entry.name}
                  </Link>
                ) : (
                  <span className="w-full truncate text-sm font-medium text-white">
                    {entry.name}
                  </span>
                )}
                <div className="mt-1 flex items-center justify-center gap-2 text-xs text-slate-500">
                  <span>{entry.sizeLabel}</span>
                  <span className="text-slate-700">·</span>
                  <span className="truncate">{entry.storageNode.name}</span>
                </div>
              </div>

              {/* Action bar — common actions stay visible, secondary actions live under 更多 */}
              <div className="flex items-center justify-center gap-1 px-3 py-3 border-t border-white/[0.04] bg-slate-950/40">
                {renderFileActions(entry, downloadUrl, previewHref, true)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════ */
  /* ── DETAILS VIEW (redesigned — card rows with clear actions) ─── */
  /* ══════════════════════════════════════════════════════════════════ */

  function renderDetailsView() {
    return (
      <div className="divide-y divide-white/[0.04]">
        {sortedFolders.length === 0 && sortedFiles.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm text-slate-400">
              {emptyMessage}
            </p>
          </div>
        ) : null}

        {/* Details folder rows */}
        {sortedFolders.map((folder) => (
          <div
            key={folder.path}
            className="flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition group"
          >
            <div className="shrink-0">
              <div className="rounded-xl bg-amber-400/10 p-2">
                <FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={28} />
              </div>
            </div>
            <div className="min-w-0 flex-1">
              <button
                type="button"
                onClick={() => navigateToFolder(folder.path)}
                className="truncate font-medium text-cyan-100 hover:text-white light:hover:text-slate-900 transition text-left text-sm"
              >
                {folder.displayName ?? folder.name}
              </button>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>目录</span>
                <span>{folder.fileCount + folder.folderCount} 项</span>
              </div>
            </div>
            <div className="shrink-0 flex items-center gap-1">
              <button
                type="button"
                onClick={() => navigateToFolder(folder.path)}
                data-tone="cyan" className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border border-cyan-400/30 text-cyan-100 hover:bg-cyan-500/25 hover:border-cyan-400/50 transition"
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
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
                打开
              </button>
              {folderCanWrite(folder) ? (
                <RenameInlineForm
                  fileEntryId={folder.entryId ?? ""}
                  currentName={folder.displayName ?? folder.name}
                  currentPath={folder.path}
                  entryType="DIRECTORY"
                  onRefresh={onRefresh}
                  onNotify={showToast}
                />
              ) : null}
              {renderFolderDownloadAction(folder)}
              {folderCanWrite(folder) && folder.entryId ? (
                <MoveInlineForm
                  fileEntryId={folder.entryId}
                  name={folder.displayName ?? folder.name}
                  relativePath={folder.path}
                  storageNodeId={folder.sourceKeys[0] ?? ""}
                  storageNodeName={folder.sourceValues[0] ?? ""}
                  onRefresh={onRefresh}
                  onNotify={showToast}
                />
              ) : null}
            </div>
          </div>
        ))}

        {/* Details file rows */}
        {sortedFiles.map((fileProp) => {
          const entry = toStorageEntry(fileProp);
          const downloadUrl = buildForcedDownloadHref(entry);
          const previewHref = getPreviewHref(entry);
          const thumbUrl = getThumbnailUrl(entry);
          const isChecked = effectiveSelectedIdSet.has(fileProp.id);

          return (
            <div
              key={entry.id}
              className={`flex items-center gap-4 px-5 py-4 hover:bg-white/[0.03] transition ${isChecked ? "bg-cyan-400/[0.04]" : ""}`}
            >
              {/* Checkbox */}
              <div className="shrink-0">
                {entryCanWrite(entry) || entryCanDelete(entry) ? (
                  <input
                    type="checkbox"
                    checked={effectiveSelectedIdSet.has(entry.id)}
                    onChange={() => toggleOne(entry.id)}
                    aria-label={`选择 ${entry.name}`}
                    className="h-4 w-4 rounded border-white/20 bg-slate-900 text-cyan-400 focus:ring-cyan-400/50"
                  />
                ) : null}
              </div>

              {/* Thumbnail or colored icon */}
              <div className="shrink-0 w-12 h-12 rounded-xl border border-white/[0.06] bg-slate-900/80 overflow-hidden flex items-center justify-center">
                {thumbUrl ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={thumbUrl}
                    alt=""
                    width={48}
                    height={48}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  <FileTypeIcon entry={entry} size={28} />
                )}
              </div>

              {/* File info */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {entry.previewable && entryCanRead(entry) ? (
                    <Link
                      href={previewHref}
                      className="truncate font-medium text-white hover:text-cyan-100 transition text-sm"
                    >
                      {entry.name}
                    </Link>
                  ) : (
                    <span className="truncate font-medium text-white text-sm">
                      {entry.name}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span>{entry.sizeLabel}</span>
                  <span>{entry.storageNode.name}</span>
                  {entry.updatedAt ? (
                    <span>{formatDate(entry.updatedAt)}</span>
                  ) : null}
                </div>
              </div>

              {/* Actions — prominent buttons */}
              <div className="shrink-0">
                {renderFileActions(entry, downloadUrl, previewHref)}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  /* ══════════════════════════════════════════════════════════════════ */
  /* ── LIST VIEW (redesigned — clean table with pill actions) ──── */
  /* ══════════════════════════════════════════════════════════════════ */

  function renderListView() {
    return (
      <>
        {/* Desktop table view (md+) */}
        <div
          className="hidden overflow-x-auto md:block"
          data-testid="file-table-scroll"
        >
          <div className="min-w-[1180px]" data-testid="file-table-inner">
            <div className="grid grid-cols-[44px_44px_minmax(280px,2.6fr)_120px_170px_160px_minmax(240px,auto)] items-center gap-3 bg-white/5 px-5 py-3 text-xs uppercase tracking-[0.15em] text-slate-400 font-medium">
              <div>
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  disabled={visibleFiles.length === 0}
                  aria-label={t("fileListClient.selectAllFiles")}
                  className="rounded h-4 w-4 accent-cyan-400"
                />
              </div>
              <div />
              <div>
                {t("fileListClient.name")} <SortIcon col="name" label={t("fileListClient.name")} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              </div>
              <div>
                {t("fileListClient.size")} <SortIcon col="size" label={t("fileListClient.size")} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              </div>
              <div>
                {t("fileListClient.source")} <SortIcon col="source" label={t("fileListClient.source")} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              </div>
              <div>
                {t("fileListClient.modified")} <SortIcon col="updated" label={t("fileListClient.modified")} sortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
              </div>
              <div>操作</div>
            </div>
            <div className="divide-y divide-white/[0.04]">
              {sortedFolders.length === 0 && sortedFiles.length === 0 ? (
                <div className="px-6 py-16 text-center text-sm text-slate-400">
                  {emptyMessage}
                </div>
              ) : null}

              {sortedFolders.map((folder) => (
                <div
                  key={folder.path}
                  className="grid grid-cols-[44px_44px_minmax(280px,2.6fr)_120px_170px_160px_minmax(240px,auto)] items-center gap-3 px-5 py-3 text-sm hover:bg-white/[0.02] transition"
                >
                  <div>
                    <input
                      type="checkbox"
                      disabled
                      aria-label={t("fileListClient.selectFolderDisabled")}
                      className="rounded h-4 w-4 accent-cyan-400 opacity-30"
                    />
                  </div>
                  <div className="flex justify-center">
                    <FileTypeIcon
                      entry={{ entryType: "DIRECTORY" }}
                      size={22}
                    />
                  </div>
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => navigateToFolder(folder.path)}
                      className="truncate font-medium text-cyan-100 hover:text-cyan-50 text-left"
                    >
                      {folder.displayName ?? folder.name}
                    </button>
                  </div>
                  <div className="text-slate-500">
                    {folder.fileCount + folder.folderCount} 项
                  </div>
                  <div className="truncate text-xs text-slate-400">
                    {folder.sourceValues[0] ?? "—"}
                  </div>
                  <div className="text-xs text-slate-500">—</div>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => navigateToFolder(folder.path)}
                      data-tone="cyan" className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-cyan-400/25 text-cyan-200 hover:bg-cyan-500/20 transition"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                      >
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                      打开
                    </button>
                    {folderCanWrite(folder) ? (
                      <RenameInlineForm
                        fileEntryId={folder.entryId ?? ""}
                        currentName={folder.displayName ?? folder.name}
                        currentPath={folder.path}
                        entryType="DIRECTORY"
                        onRefresh={onRefresh}
                        onNotify={showToast}
                      />
                    ) : null}
                    {renderFolderDownloadAction(folder, true)}
                    {folderCanWrite(folder) && folder.entryId ? (
                      <MoveInlineForm
                        fileEntryId={folder.entryId}
                        name={folder.displayName ?? folder.name}
                        relativePath={folder.path}
                        storageNodeId={folder.sourceKeys[0] ?? ""}
                        storageNodeName={folder.sourceValues[0] ?? ""}
                        onRefresh={onRefresh}
                        onNotify={showToast}
                      />
                    ) : null}
                  </div>
                </div>
              ))}

              {sortedFiles.map((fileProp) => {
                const entry = toStorageEntry(fileProp);
                const downloadUrl = buildForcedDownloadHref(entry);
                const previewHref = getPreviewHref(entry);
                const isChecked = effectiveSelectedIdSet.has(fileProp.id);

                return (
                  <div
                    key={entry.id}
                    className={`grid grid-cols-[44px_44px_minmax(280px,2.6fr)_120px_170px_160px_minmax(240px,auto)] items-center gap-3 px-5 py-3 text-sm hover:bg-white/[0.02] transition ${isChecked ? "bg-cyan-400/[0.04]" : ""}`}
                  >
                    <div>
                      {entryCanWrite(entry) || entryCanDelete(entry) ? (
                        <input
                          type="checkbox"
                          checked={effectiveSelectedIdSet.has(entry.id)}
                          onChange={() => toggleOne(entry.id)}
                          aria-label={`选择 ${entry.name}`}
                          className="h-4 w-4 rounded border-white/20 bg-slate-900 text-cyan-400 focus:ring-cyan-400/50"
                        />
                      ) : null}
                    </div>
                    <div className="flex justify-center">
                      <FileTypeIcon entry={entry} size={22} />
                    </div>
                    <div className="min-w-0">
                      {entry.previewable && entryCanRead(entry) ? (
                        <Link
                          href={previewHref}
                          className="truncate font-medium text-white hover:text-cyan-100 transition"
                        >
                          {entry.name}
                        </Link>
                      ) : (
                        <span className="truncate font-medium text-white">
                          {entry.name}
                        </span>
                      )}
                      <p className="mt-0.5 truncate text-xs text-slate-600">
                        {entry.relativePath}
                      </p>
                    </div>
                    <div className="text-slate-300">
                      {entry.sizeLabel}
                    </div>
                    <div className="text-slate-400 truncate text-xs">
                      {entry.storageNode.name}
                    </div>
                    <div className="text-slate-500 text-xs">
                      {entry.updatedAt ? formatDate(entry.updatedAt) : "—"}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {renderFileActions(entry, downloadUrl, previewHref, true)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Mobile card view (below md) */}
        <div className="md:hidden divide-y divide-white/[0.04]">
          {sortedFolders.length === 0 && sortedFiles.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-slate-400">
              {emptyMessage}
            </div>
          ) : null}

          {sortedFolders.map((folder) => (
            <div
              key={folder.path}
              className="px-4 py-3 hover:bg-white/[0.02] transition"
            >
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-amber-400/10 p-1.5">
                  <FileTypeIcon entry={{ entryType: "DIRECTORY" }} size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => navigateToFolder(folder.path)}
                    className="truncate font-medium text-cyan-100 hover:text-cyan-50 text-left text-sm"
                  >
                    {folder.displayName ?? folder.name}
                  </button>
                  <div className="mt-0.5 text-xs text-slate-500">
                    {folder.fileCount + folder.folderCount} 项
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigateToFolder(folder.path)}
                  data-tone="cyan" className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-cyan-400/25 text-cyan-200 hover:bg-cyan-500/20 transition"
                >
                  打开
                </button>
              </div>
              {entryCanRead(folder) || folderCanWrite(folder) ? (
                <div className="mt-2 flex flex-wrap gap-1 pl-9">
                  {renderFolderDownloadAction(folder, true)}
                  {folderCanWrite(folder) ? (
                    <RenameInlineForm
                      fileEntryId={folder.entryId ?? ""}
                      currentName={folder.displayName ?? folder.name}
                      currentPath={folder.path}
                      entryType="DIRECTORY"
                      onRefresh={onRefresh}
                      onNotify={showToast}
                    />
                  ) : null}
                  {folderCanWrite(folder) && folder.entryId ? (
                    <MoveInlineForm
                      fileEntryId={folder.entryId}
                      name={folder.displayName ?? folder.name}
                      relativePath={folder.path}
                      storageNodeId={folder.sourceKeys[0] ?? ""}
                      storageNodeName={folder.sourceValues[0] ?? ""}
                      onRefresh={onRefresh}
                      onNotify={showToast}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}

          {sortedFiles.map((fileProp) => {
            const entry = toStorageEntry(fileProp);
            const downloadUrl = buildForcedDownloadHref(entry);
            const previewHref = getPreviewHref(entry);
            const isChecked = effectiveSelectedIdSet.has(fileProp.id);

            return (
              <div
                key={entry.id}
                className={`px-4 py-3 ${isChecked ? "bg-cyan-400/[0.04]" : ""}`}
              >
                <div className="flex items-start gap-3">
                  {entryCanWrite(entry) || entryCanDelete(entry) ? (
                    <input
                      type="checkbox"
                      checked={effectiveSelectedIdSet.has(entry.id)}
                      onChange={() => toggleOne(entry.id)}
                      aria-label={`选择 ${entry.name}`}
                      className="mt-2 h-4 w-4 rounded border-white/20 bg-slate-900 text-cyan-400 focus:ring-cyan-400/50"
                    />
                  ) : null}
                  <div className="shrink-0 mt-0.5 rounded-lg bg-white/[0.03] p-1">
                    <FileTypeIcon entry={entry} size={22} />
                  </div>
                  <div className="min-w-0 flex-1">
                    {entry.previewable && entryCanRead(entry) ? (
                      <Link
                        href={previewHref}
                        className="truncate font-medium text-white text-sm hover:text-cyan-100 transition"
                      >
                        {entry.name}
                      </Link>
                    ) : (
                      <span className="truncate font-medium text-white text-sm">
                        {entry.name}
                      </span>
                    )}
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{entry.sizeLabel}</span>
                      <span>{entry.storageNode.name}</span>
                      {entry.updatedAt ? (
                        <span>{formatDate(entry.updatedAt)}</span>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1 pl-9">
                  {renderFileActions(entry, downloadUrl, previewHref, true)}
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }

  /* ══════════════════════════════════════════════════════════════════ */
  /* ── MAIN RENDER ────────────────────────────────────────────────── */
  /* ══════════════════════════════════════════════════════════════════ */

  return (
    <>
      {toasts.length > 0 ? (
        <div
          className="fixed left-1/2 top-4 z-[70] flex w-[min(92vw,520px)] -translate-x-1/2 flex-col gap-2"
          aria-live="polite"
          aria-atomic="true"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role={toast.type === "error" ? "alert" : "status"}
              className={[
                "flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-sm shadow-2xl backdrop-blur-xl",
                toast.type === "success"
                  ? "border-emerald-300/40 bg-emerald-500/95 text-white shadow-emerald-950/30"
                  : "",
                toast.type === "error"
                  ? "border-rose-300/40 bg-rose-500/95 text-white shadow-rose-950/30"
                  : "",
                toast.type === "info"
                  ? "border-cyan-300/40 bg-cyan-500/95 text-white shadow-cyan-950/30"
                  : "",
              ].join(" ")}
            >
              <span>{toast.message}</span>
              <button
                type="button"
                onClick={() => dismissToast(toast.id)}
                className="rounded-full px-1.5 text-white/80 hover:bg-white/15 hover:text-white"
                aria-label={t("fileListClient.closeNotice")}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-6 overflow-x-auto rounded-2xl border border-white/[0.08]">
        {/* View mode toggle header bar */}
        <div className="flex items-center justify-between bg-white/[0.03] px-5 py-2.5 border-b border-white/[0.06]">
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <span>{sortedFolders.length + sortedFiles.length} 项</span>
            {selectedCount > 0 ? (
              <span className="text-cyan-300 font-medium">
                · 已选 {selectedCount} 个
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-slate-950/80 p-1">
            <button
              type="button"
              onClick={() => handleViewModeChange("list")}
              title={t("fileListClient.listView")}
              aria-label={t("fileListClient.listView")}
              aria-pressed={viewMode === "list"}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                viewMode === "list"
                  ? "bg-cyan-400/20 text-cyan-100 border border-cyan-400/30 shadow-sm shadow-cyan-400/10"
                  : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
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
              onClick={() => handleViewModeChange("grid")}
              title={t("fileListClient.iconView")}
              aria-label={t("fileListClient.iconView")}
              aria-pressed={viewMode === "grid"}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                viewMode === "grid"
                  ? "bg-cyan-400/20 text-cyan-100 border border-cyan-400/30 shadow-sm shadow-cyan-400/10"
                  : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
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
              onClick={() => handleViewModeChange("details")}
              title={t("fileListClient.detailView")}
              aria-label={t("fileListClient.detailView")}
              aria-pressed={viewMode === "details"}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                viewMode === "details"
                  ? "bg-cyan-400/20 text-cyan-100 border border-cyan-400/30 shadow-sm shadow-cyan-400/10"
                  : "text-slate-400 hover:text-white hover:bg-white/5 border border-transparent"
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

        {/* View content */}
        {viewMode === "list"
          ? renderListView()
          : viewMode === "grid"
            ? renderGridView()
            : renderDetailsView()}
      </div>

      {detailEntry ? (
        <FileDetailPanelLazy
          detailEntry={detailEntry}
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
      />
    </>
  );
}
