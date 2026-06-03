"use client";

import { useState, useCallback, useTransition, useMemo, useId } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { deleteFileEntryAction } from "../storage/actions";
import { moveFileAction } from "./move-file-action";
import { DeleteConfirmButton } from "./delete-confirm-button";
import { RenameInlineForm } from "./rename-inline-form";
import { MoveInlineForm } from "./move-inline-form";
import { DownloadIcon, FileTypeIcon, PreviewIcon } from "./file-entry-icons";
import {
  appendDownloadFlag,
  buildArchiveDownloadHref,
  buildDownloadHref,
  buildSearchHref,
  formatDate,
  getPreviewHref,
  getThumbnailUrl,
  toStorageEntry,
  type FileProp,
  type StorageEntry,
} from "./file-entry-utils";

/* ── serialisable folder type (no Map) ────────────────────────────── */

export type FolderProp = {
  name: string;
  displayName?: string;
  path: string;
  entryId?: string | null;
  storageNodeId?: string | null;
  relativePath?: string | null;
  capabilities?: FileProp["capabilities"];
  fileCount: number;
  folderCount: number;
  sourceKeys: string[];
  sourceValues: string[];
};

export type { FileProp } from "./file-entry-utils";

/* ── component props ──────────────────────────────────────────────── */

type FileListClientProps = {
  folders: FolderProp[];
  files: FileProp[];
  canEditLocalFiles: boolean;
  canDelete: boolean;
  currentPath: string;
  searchQuery: string;
  selectionScopeSeed?: string;
  onFolderClick?: (path: string) => void;
  onRefresh?: () => void;
};


/* ── view mode type ───────────────────────────────────────────────── */

type ViewMode = "list" | "grid" | "details";
type BatchProgress = { done: number; total: number; errors: string[] };

/* ── main component ───────────────────────────────────────────────── */

export function FileListClient({
  folders,
  files,
  canEditLocalFiles,
  canDelete,
  currentPath,
  searchQuery,
  selectionScopeSeed,
  onFolderClick,
  onRefresh,
}: FileListClientProps) {

  const router = useRouter();
  const fileListId = useId();
  const batchToolbarTitleId = `${fileListId}-batch-toolbar-title`;
  const batchToolbarDescriptionId = `${fileListId}-batch-toolbar-description`;
  const batchErrorTitleId = `${fileListId}-batch-error-title`;

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

  const VIEW_MODE_KEY = "app-file-view-mode";
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY) as ViewMode | null;
      if (saved && ["list", "grid", "details"].includes(saved)) return saved;
    } catch {
      /* ignore */
    }
    return "list";
  });

  const handleViewModeChange = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  // Sort state
  type SortKey = "name" | "size" | "source" | "updated";
  type SortDir = "asc" | "desc";
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = useCallback((key: SortKey) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const sortedFolders = useMemo(() => {
    const arr = [...folders];
    if (sortKey === "name")
      arr.sort((a, b) =>
        (a.displayName ?? a.name).localeCompare(
          b.displayName ?? b.name,
          "zh-CN",
        ),
      );
    if (sortDir === "desc") arr.reverse();
    return arr;
  }, [folders, sortKey, sortDir]);

  const visibleFiles = useMemo(
    () =>
      files.filter(
        (file) =>
          file.entryType !== "DIRECTORY" && file.mimeType !== "inode/directory",
      ),
    [files],
  );
  const currentSelectionScopeKey =
    selectionScopeSeed ?? `${currentPath}\u0000${searchQuery}`;
  const entryCanRead = useCallback(
    (entry: { capabilities?: FileProp["capabilities"] }) =>
      entry.capabilities?.canRead ?? true,
    [],
  );
  const entryCanWrite = useCallback(
    (entry: { capabilities?: FileProp["capabilities"] }) =>
      entry.capabilities?.canWrite ?? canEditLocalFiles,
    [canEditLocalFiles],
  );
  const entryCanDelete = useCallback(
    (entry: { capabilities?: FileProp["capabilities"] }) =>
      entry.capabilities?.canDelete ?? canDelete,
    [canDelete],
  );
  const selectableFiles = useMemo(
    () =>
      visibleFiles.filter((file) => entryCanWrite(file) || entryCanDelete(file)),
    [visibleFiles, entryCanWrite, entryCanDelete],
  );
  const folderCanWrite = useCallback(
    (folder: FolderProp) =>
      folder.capabilities?.canWrite ?? canEditLocalFiles,
    [canEditLocalFiles],
  );

  const sortedFiles = useMemo(() => {
    const arr = [...visibleFiles];
    const cmp = (a: FileProp, b: FileProp) => {
      switch (sortKey) {
        case "name":
          return a.name.localeCompare(b.name, "zh-CN");
        case "size":
          return (a.sizeBytes ?? -1) - (b.sizeBytes ?? -1);
        case "source":
          return a.storageNodeName.localeCompare(b.storageNodeName, "zh-CN");
        case "updated":
          return (a.updatedAt ?? "").localeCompare(b.updatedAt ?? "");
        default:
          return 0;
      }
    };
    arr.sort(cmp);
    if (sortDir === "desc") arr.reverse();
    return arr;
  }, [visibleFiles, sortKey, sortDir]);

  function SortIcon({ col, label }: { col: SortKey; label: string }) {
    const active = sortKey === col;
    return (
      <button
        type="button"
        onClick={() => toggleSort(col)}
        aria-label={`按${label}排序`}
        className="inline-flex items-center gap-1 hover:text-white transition"
      >
        {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </button>
    );
  }

  // Selection state (list view only)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectedScopeKey, setSelectedScopeKey] = useState(
    () => currentSelectionScopeKey,
  );
  const [batchAction, setBatchAction] = useState<
    "none" | "confirm-delete" | "deleting" | "moving"
  >("none");
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
  const [isPending, startTransition] = useTransition();

  const allFileIds = selectableFiles.map((f) => f.id);
  const selectableFileIdSet = useMemo(() => new Set(allFileIds), [allFileIds]);
  const selectedScopeMatches = selectedScopeKey === currentSelectionScopeKey;
  const effectiveSelectedIds = useMemo(
    () =>
      selectedScopeMatches
        ? [...selectedIds].filter((id) => selectableFileIdSet.has(id))
        : [],
    [selectedIds, selectableFileIdSet, selectedScopeMatches],
  );
  const effectiveSelectedIdSet = useMemo(
    () => new Set(effectiveSelectedIds),
    [effectiveSelectedIds],
  );
  const selectedCount = effectiveSelectedIds.length;
  const selectedFileEntries = useMemo(
    () => visibleFiles.filter((file) => effectiveSelectedIdSet.has(file.id)),
    [visibleFiles, effectiveSelectedIdSet],
  );
  const selectedEntriesCanDelete =
    selectedCount > 0 && selectedFileEntries.every(entryCanDelete);
  const selectedEntriesCanMove =
    selectedCount > 0 && selectedFileEntries.every(entryCanWrite);
  const allSelected =
    selectableFiles.length > 0 && allFileIds.every((id) => effectiveSelectedIdSet.has(id));
  const someSelected = selectedCount > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    setSelectedScopeKey(currentSelectionScopeKey);
    setBatchAction("none");
    setMoveTargetDir("");
    setProgress({ done: 0, total: 0, errors: [] });
    setMoveProgress({ done: 0, total: 0, errors: [] });
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allFileIds));
    }
  }, [allSelected, allFileIds, currentSelectionScopeKey]);

  const toggleOne = useCallback((id: string) => {
    setSelectedScopeKey(currentSelectionScopeKey);
    setBatchAction("none");
    setMoveTargetDir("");
    setProgress({ done: 0, total: 0, errors: [] });
    setMoveProgress({ done: 0, total: 0, errors: [] });
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
  }, [currentSelectionScopeKey, selectedScopeMatches]);

  const clearSelection = useCallback(() => {
    setSelectedScopeKey(currentSelectionScopeKey);
    setSelectedIds(new Set());
    setBatchAction("none");
    setProgress({ done: 0, total: 0, errors: [] });
    setMoveProgress({ done: 0, total: 0, errors: [] });
    setMoveTargetDir("");
  }, [currentSelectionScopeKey]);

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
        clearSelection();
        return;
      }
      setBatchAction("none");
      setSelectedScopeKey(currentSelectionScopeKey);
      setSelectedIds(new Set(ids));
      setProgress({ done: completed, total: ids.length, errors: [...errors] });
    });
  }, [effectiveSelectedIds, files, router, clearSelection, onRefresh, currentSelectionScopeKey]);

  const handleBatchMove = useCallback(() => {
    setBatchAction("moving");
    setMoveTargetDir("");
    setMoveProgress({ done: 0, total: 0, errors: [] });
  }, []);

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
        clearSelection();
        return;
      }
      setBatchAction("none");
      setSelectedScopeKey(currentSelectionScopeKey);
      setSelectedIds(new Set(ids));
      setMoveProgress({
        done: completed,
        total: ids.length,
        errors: [...errors],
      });
    });
  }, [effectiveSelectedIds, moveTargetDir, files, router, clearSelection, onRefresh, currentSelectionScopeKey]);

  const emptyMessage = searchQuery
    ? `未找到匹配 "${searchQuery}" 的文件。`
    : "当前目录暂无内容。";

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
        title="下载"
        aria-label={`下载 ${entry.name}`}
        download={downloadUrl.startsWith("/") ? true : undefined}
        target={downloadUrl.startsWith("/") ? undefined : "_blank"}
        rel={downloadUrl.startsWith("/") ? undefined : "noopener noreferrer"}
        className={compact
          ? "inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 hover:text-white"
          : "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-slate-200 transition hover:bg-white/10 hover:text-white"}
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
        title="下载目录归档"
        aria-label={`下载目录 ${folder.displayName ?? folder.name}`}
        download
        className={compact
          ? "inline-flex items-center justify-center w-8 h-8 rounded-lg border border-white/10 bg-white/5 text-slate-200 transition hover:bg-white/10 hover:text-white"
          : "inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-white/10 hover:text-white"}
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
    return (
      <div className="flex items-center gap-1 flex-wrap">
        {entry.previewable && entryCanRead(entry) ? (
          <Link
            href={previewHref}
            title="预览"
            className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-100 transition hover:bg-cyan-500/20"
          >
            <PreviewIcon />
          </Link>
        ) : null}
        {renderDownloadActions(entry, downloadUrl, compact)}
        {entryCanWrite(entry) ? (
          <RenameInlineForm
            fileEntryId={entry.id}
            currentName={entry.name}
            currentPath={entry.relativePath}
            entryType={entry.entryType as "FILE" | "DIRECTORY"}
            onRefresh={onRefresh}
          />
        ) : null}
        {entryCanWrite(entry) ? (
          <MoveInlineForm
            fileEntryId={entry.id}
            name={entry.name}
            relativePath={entry.relativePath}
            storageNodeId={entry.storageNode.id}
            storageNodeName={entry.storageNode.name}
            onRefresh={onRefresh}
          />
        ) : null}
        {canDelete && entryCanDelete(entry) ? (
          <DeleteConfirmButton
            fileEntryId={entry.id}
            entryName={entry.name}
            entryType={entry.entryType as "FILE" | "DIRECTORY"}
            onRefresh={onRefresh}
          />
        ) : null}
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
            <p className="text-sm text-slate-400">{emptyMessage}</p>
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
            <span className="w-full truncate text-sm font-medium text-cyan-100 group-hover:text-white transition">
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
          const downloadUrl = appendDownloadFlag(buildDownloadHref(entry));
          const previewHref = getPreviewHref(entry);
          const isChecked = effectiveSelectedIdSet.has(fileProp.id);

          return (
            <div
              key={entry.id}
              className={`group relative flex flex-col rounded-2xl border border-white/[0.06] bg-slate-900/80 text-center transition-all duration-200 hover:border-cyan-400/20 hover:shadow-lg hover:shadow-cyan-400/5 overflow-hidden ${isChecked ? "ring-2 ring-cyan-400/50 bg-cyan-400/[0.04]" : ""}`}
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

              {/* Action bar — always visible, icon buttons */}
              <div className="flex items-center justify-center gap-1 px-3 py-3 border-t border-white/[0.04] bg-slate-950/40">
                {entry.previewable && entryCanRead(entry) ? (
                  <Link
                    href={previewHref}
                    title="预览"
                    className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-100 transition hover:bg-cyan-500/20"
                  >
                    <PreviewIcon />
                  </Link>
                ) : null}
                {renderDownloadActions(entry, downloadUrl, true)}
                {entryCanWrite(entry) ? (
                  <RenameInlineForm
                    fileEntryId={entry.id}
                    currentName={entry.name}
                    currentPath={entry.relativePath}
                    entryType={entry.entryType as "FILE" | "DIRECTORY"}
                    onRefresh={onRefresh}
                  />
                ) : null}
                {entryCanWrite(entry) ? (
                  <MoveInlineForm
                    fileEntryId={entry.id}
                    name={entry.name}
                    relativePath={entry.relativePath}
                    storageNodeId={entry.storageNode.id}
                    storageNodeName={entry.storageNode.name}
                    onRefresh={onRefresh}
                  />
                ) : null}
                {canDelete && entryCanDelete(entry) ? (
                  <DeleteConfirmButton
                    fileEntryId={entry.id}
                    entryName={entry.name}
                    entryType={entry.entryType as "FILE" | "DIRECTORY"}
                    onRefresh={onRefresh}
                  />
                ) : null}
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
            <p className="text-sm text-slate-400">{emptyMessage}</p>
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
                className="truncate font-medium text-cyan-100 hover:text-white transition text-left text-sm"
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
                className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium border border-cyan-400/30 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/25 hover:border-cyan-400/50 transition"
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
                />
              ) : null}
            </div>
          </div>
        ))}

        {/* Details file rows */}
        {sortedFiles.map((fileProp) => {
          const entry = toStorageEntry(fileProp);
          const downloadUrl = appendDownloadFlag(buildDownloadHref(entry));
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
                  aria-label="全选文件"
                  className="rounded h-4 w-4 accent-cyan-400"
                />
              </div>
              <div />
              <div>
                名称 <SortIcon col="name" label="名称" />
              </div>
              <div>
                大小 <SortIcon col="size" label="大小" />
              </div>
              <div>
                来源 <SortIcon col="source" label="来源" />
              </div>
              <div>
                修改时间 <SortIcon col="updated" label="修改时间" />
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
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition"
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
                      />
                    ) : null}
                  </div>
                </div>
              ))}

              {sortedFiles.map((fileProp) => {
                const entry = toStorageEntry(fileProp);
                const downloadUrl = appendDownloadFlag(buildDownloadHref(entry));
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
                    <div className="text-slate-300">{entry.sizeLabel}</div>
                    <div className="text-slate-400 truncate text-xs">
                      {entry.storageNode.name}
                    </div>
                    <div className="text-slate-500 text-xs">
                      {entry.updatedAt ? formatDate(entry.updatedAt) : "—"}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {entry.previewable && entryCanRead(entry) ? (
                        <Link
                          href={previewHref}
                          title="预览"
                          className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-100 transition hover:bg-cyan-500/20"
                        >
                          <PreviewIcon />
                        </Link>
                      ) : null}
                      {renderDownloadActions(entry, downloadUrl, true)}
                      {entryCanWrite(entry) ? (
                        <RenameInlineForm
                          fileEntryId={entry.id}
                          currentName={entry.name}
                          currentPath={entry.relativePath}
                          entryType={entry.entryType as "FILE" | "DIRECTORY"}
                          onRefresh={onRefresh}
                        />
                      ) : null}
                      {entryCanWrite(entry) ? (
                        <MoveInlineForm
                          fileEntryId={entry.id}
                          name={entry.name}
                          relativePath={entry.relativePath}
                          storageNodeId={entry.storageNode.id}
                          storageNodeName={entry.storageNode.name}
                          onRefresh={onRefresh}
                        />
                      ) : null}
                      {canDelete && entryCanDelete(entry) ? (
                        <DeleteConfirmButton
                          fileEntryId={entry.id}
                          entryName={entry.name}
                          entryType={entry.entryType as "FILE" | "DIRECTORY"}
                          onRefresh={onRefresh}
                        />
                      ) : null}
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
                  className="shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium border border-cyan-400/25 bg-cyan-500/10 text-cyan-200 hover:bg-cyan-500/20 transition"
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
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          ))}

          {sortedFiles.map((fileProp) => {
            const entry = toStorageEntry(fileProp);
            const downloadUrl = appendDownloadFlag(buildDownloadHref(entry));
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
                  {entry.previewable && entryCanRead(entry) ? (
                    <Link
                      href={previewHref}
                      title="预览"
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-cyan-400/30 bg-cyan-500/10 text-cyan-100 transition hover:bg-cyan-500/20"
                    >
                      <PreviewIcon />
                    </Link>
                  ) : null}
                  {renderDownloadActions(entry, downloadUrl, true)}
                  {entryCanWrite(entry) ? (
                    <RenameInlineForm
                      fileEntryId={entry.id}
                      currentName={entry.name}
                      currentPath={entry.relativePath}
                      entryType={entry.entryType as "FILE" | "DIRECTORY"}
                      onRefresh={onRefresh}
                    />
                  ) : null}
                  {entryCanWrite(entry) ? (
                    <MoveInlineForm
                      fileEntryId={entry.id}
                      name={entry.name}
                      relativePath={entry.relativePath}
                      storageNodeId={entry.storageNode.id}
                      storageNodeName={entry.storageNode.name}
                      onRefresh={onRefresh}
                    />
                  ) : null}
                  {canDelete && entryCanDelete(entry) ? (
                    <DeleteConfirmButton
                      fileEntryId={entry.id}
                      entryName={entry.name}
                      entryType={entry.entryType as "FILE" | "DIRECTORY"}
                      onRefresh={onRefresh}
                    />
                  ) : null}
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
              title="列表视图"
              aria-label="列表视图"
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
              title="图标视图"
              aria-label="图标视图"
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
              title="详情视图"
              aria-label="详情视图"
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

      {selectedScopeMatches &&
      (progress.errors.length > 0 || moveProgress.errors.length > 0) ? (
        <div
          role="alert"
          aria-labelledby={batchErrorTitleId}
          className="fixed bottom-20 left-1/2 z-50 max-w-lg -translate-x-1/2 rounded-2xl border border-amber-400/30 bg-amber-950/95 px-4 py-3 text-sm text-amber-100 shadow-2xl"
        >
          <p id={batchErrorTitleId} className="font-medium">
            批量操作完成，{progress.errors.length + moveProgress.errors.length}{" "}
            个失败
          </p>
          <ul className="mt-1 max-h-28 overflow-y-auto text-xs text-amber-100/80">
            {[...progress.errors, ...moveProgress.errors].map((error) => (
              <li key={error}>• {error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Batch action toolbar (all view modes) */}
      {selectedCount > 0 ? (
        <div
          role="region"
          aria-labelledby={batchToolbarTitleId}
          aria-describedby={batchToolbarDescriptionId}
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-slate-900/95 backdrop-blur border border-white/10 rounded-2xl shadow-2xl px-5 py-3"
        >
          <span id={batchToolbarTitleId} className="sr-only">
            文件批量操作
          </span>
          <span id={batchToolbarDescriptionId} className="sr-only">
            已选择 {selectedCount} 个文件，可取消选择或执行当前权限允许的批量操作。
          </span>
          {batchAction === "confirm-delete" ? (
            <>
              <span className="text-sm text-rose-200">
                确认删除 {selectedCount} 个文件？
              </span>
              <button
                type="button"
                onClick={handleBatchDelete}
                disabled={isPending}
                className="rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20 disabled:opacity-50"
              >
                确认删除
              </button>
              <button
                type="button"
                onClick={() => setBatchAction("none")}
                disabled={isPending}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
              >
                取消
              </button>
            </>
          ) : batchAction === "deleting" ? (
            <>
              <span className="text-sm text-rose-200">
                已删除 {progress.done}/{progress.total} 个
              </span>
              {progress.done < progress.total ? (
                <div className="h-2 w-24 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-rose-400 transition-all"
                    style={{
                      width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
              ) : null}
              {progress.errors.length > 0 ? (
                <span className="text-sm text-amber-200">
                  {progress.errors.length} 个失败
                </span>
              ) : null}
            </>
          ) : batchAction === "moving" ? (
            <>
              <span className="text-sm text-slate-200">目标路径：</span>
              <input
                type="text"
                value={moveTargetDir}
                onChange={(e) => setMoveTargetDir(e.currentTarget.value)}
                placeholder={currentPath || "目标路径"}
                aria-label="批量移动目标路径"
                className="w-40 rounded-2xl border border-white/10 bg-slate-950 px-3 py-1.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
              />
              {moveProgress.total > 0 ? (
                <span className="text-sm text-cyan-200">
                  已移动 {moveProgress.done}/{moveProgress.total} 个
                  {moveProgress.errors.length > 0
                    ? `（${moveProgress.errors.length} 个失败）`
                    : ""}
                </span>
              ) : null}
              <button
                type="button"
                onClick={submitBatchMove}
                disabled={
                  !moveTargetDir.trim() || isPending || moveProgress.done > 0
                }
                className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
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
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10 disabled:opacity-50"
              >
                取消
              </button>
            </>
          ) : (
            <>
              <span className="text-sm text-slate-200">
                已选 {selectedCount} 个文件
              </span>
              <button
                type="button"
                onClick={clearSelection}
                className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/10"
              >
                取消选择
              </button>
              {canDelete && selectedEntriesCanDelete ? (
                <button
                  type="button"
                  onClick={() => setBatchAction("confirm-delete")}
                  className="rounded-full border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-400/20"
                >
                  批量删除
                </button>
              ) : null}
              {selectedEntriesCanMove ? (
                <button
                  type="button"
                  onClick={handleBatchMove}
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
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
