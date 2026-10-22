"use client";

import { pickPreferredStorageNode } from "@/lib/storage/preferred-node";
import { useState, useCallback, useEffect, useRef, type DragEvent, type ReactNode } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { FileListClient } from "./file-list-client";
import { FileUploadDropzoneLazy } from "./file-upload-dropzone-lazy";
import { useFileBrowserListing } from "./use-file-browser-listing";
import {
  type FilesApiResponse,
  getInitialExpandedTreePaths,
  getCurrentPathDisplay,
} from "./files-browser-helpers";
import { DriveSidebar } from "./drive-sidebar";
import { DriveBreadcrumbs, DriveSearchBar, NewFolderDialog, SortMenu, UploadMenu, ViewToggle, type DriveSearchMode } from "./drive-toolbar";
import { ContentSearchResults, useContentSearch } from "./unified-file-search";
import { FileCollectionsDialog, type FileCollectionMode } from "./file-preferences-client";
import { useViewMode } from "./use-view-mode";
import { ActionButton } from "@/components/action-button";
import { IconButton, Notice, Spinner } from "@/components/ui-primitives";
import { Dialog } from "@/components/ui/dialog";
import { Pagination } from "@/components/pagination";
import { FolderPlus, RefreshCw, Upload, X } from "@/components/icons";
import { IconPanelLeft } from "@/components/nav-icons";
import { KnownErrorNotice } from "@/components/known-error-notice";
import { useStorageUploads } from "@/components/storage/storage-upload-provider";
import { readDroppedFiles } from "@/components/storage/storage-drop-files";
import { getBrowserRelativePath, normalizeRelativePath } from "@/components/storage/file-upload-helpers";

const UPLOAD_DRIVERS = new Set(["LOCAL", "SFTP", "WEBDAV"]);

export function FilesBrowserSpa({
  initialData,
  children,
}: {
  initialData: FilesApiResponse;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const {
    data,
    loading,
    listError,
    selectionEpoch,
    searchInput,
    setSearchInput,
    fetchFiles,
  } = useFileBrowserListing({ initialData });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  // Files dropped where no target is set yet; the upload dialog holds them.
  const [pendingUploadFiles, setPendingUploadFiles] = useState<File[]>([]);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [collection, setCollection] = useState<{ mode: FileCollectionMode; key: number } | null>(null);
  const [searchMode, setSearchMode] = useState<DriveSearchMode>(initialData.searchScope === "all" ? "all" : "current");
  const [dropError, setDropError] = useState("");
  const [dragDepth, setDragDepth] = useState(0);
  const [viewMode] = useViewMode();
  const uploads = useStorageUploads();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const contentSearch = useContentSearch({ nodeId: data.nodeIdFilter || undefined, searchPath: data.currentPath || undefined });

  // Keep the browser feeling like a desktop drive: `/` focuses search and
  // Escape closes transient UI. Ignore shortcuts while typing in another
  // control so normal file-name entry is never interrupted.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const editing = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
      if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "/" && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "Escape" && mobileSidebarOpen) setMobileSidebarOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSidebarOpen]);

  const canEdit = data.permissions.canEditLocalFiles;
  const selectedNode = data.nodes.find((node) => node.id === data.nodeIdFilter);
  const uploadNodes = data.nodes.filter((node) => UPLOAD_DRIVERS.has(node.driver));
  // Without a node filter, start uploads on a node that can take them: the
  // newest node is often a draft server's storage that has never connected.
  const preferredUploadNode = data.nodeIdFilter && uploadNodes.some((node) => node.id === data.nodeIdFilter)
    ? data.nodeIdFilter
    : pickPreferredStorageNode(uploadNodes)?.id ?? pickPreferredStorageNode(data.nodes)?.id;
  const currentPathDisplay = getCurrentPathDisplay(t, data.currentPath, data.nodes, data.nodeIdFilter);
  const directUpload = Boolean(selectedNode && UPLOAD_DRIVERS.has(selectedNode.driver));
  const refreshLabel = selectedNode?.driver === "SFTP" ? t("filesBrowserSpa.refreshRemoteFiles") : t("filesBrowserSpa.refreshList");

  const treeLocation = `${data.nodeIdFilter}:${data.currentPath}`;
  const [treeExpansion, setTreeExpansion] = useState(() => ({
    location: treeLocation,
    paths: getInitialExpandedTreePaths(initialData.tree, initialData.currentPath),
  }));
  // Derived state sync: fold newly-ancestral tree paths in when the location
  // changes. Runs in an effect (not during render) so navigation renders once.
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot derived-state sync, same intentional pattern as install-dialog.tsx */
  useEffect(() => {
    setTreeExpansion((current) => {
      if (current.location === treeLocation) return current;
      return {
        location: treeLocation,
        paths: new Set([...current.paths, ...getInitialExpandedTreePaths(data.tree, data.currentPath)]),
      };
    });
    // Re-derive only on location change, mirroring the previous render-time check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeLocation]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const toggleTreePath = useCallback((path: string) => {
    setTreeExpansion((current) => {
      const next = new Set(current.paths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { ...current, paths: next };
    });
  }, []);

  const refreshCurrentListing = useCallback(
    () => fetchFiles(data.currentPath, data.searchQuery, data.searchScope, data.nodeIdFilter),
    [data.currentPath, data.nodeIdFilter, data.searchQuery, data.searchScope, fetchFiles],
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onCompleted = (event: Event) => {
      if (uploadOpen || (data.nodeIdFilter && (event as CustomEvent<{ nodeId: string }>).detail.nodeId !== data.nodeIdFilter)) return;
      clearTimeout(timer);
      timer = setTimeout(() => { void refreshCurrentListing(); }, 350);
    };
    window.addEventListener("storage-upload-completed", onCompleted);
    const onOperationCompleted = () => { clearTimeout(timer); timer = setTimeout(() => { void refreshCurrentListing(); }, 350); };
    window.addEventListener("file-operation-completed", onOperationCompleted);
    return () => { clearTimeout(timer); window.removeEventListener("storage-upload-completed", onCompleted); window.removeEventListener("file-operation-completed", onOperationCompleted); };
  }, [data.nodeIdFilter, refreshCurrentListing, uploadOpen]);

  const navigateToFolder = useCallback((path: string) => {
    void fetchFiles(path, undefined, undefined, undefined, { resetSelection: true, history: "push" });
  }, [fetchFiles]);

  const selectNode = useCallback((nodeId: string) => {
    setUploadOpen(false);
    setPendingUploadFiles([]);
    setMobileSidebarOpen(false);
    setSearchInput("");
    contentSearch.reset();
    void fetchFiles("", undefined, undefined, nodeId, { resetSelection: true, history: "push" });
  }, [fetchFiles, setSearchInput, contentSearch]);

  const treeNavigate = useCallback((path: string) => {
    navigateToFolder(path);
    setMobileSidebarOpen(false);
  }, [navigateToFolder]);

  /** Queue files for the folder on screen; elsewhere ask where they go. */
  const startUpload = useCallback(async (read: () => Promise<File[]> | File[]) => {
    const nodeId = data.nodeIdFilter;
    try {
      if (!canEdit) throw new Error(t("filesBrowserSpa.cannotCreateFolderNoPermission"));
      if (!nodeId || !directUpload) {
        // Keep what was dropped for the dialog: it used to open empty and the
        // user had to drop or pick the files a second time.
        setPendingUploadFiles(await read());
        setUploadOpen(true);
        return;
      }
      const files = await read();
      const entries = files.map((file) => {
        const path = normalizeRelativePath([data.currentPath, getBrowserRelativePath(file)].filter(Boolean).join("/"));
        if (!path.ok) throw new Error(t(`fileUploadDropzone.pathError.${path.reason}`));
        return { file, path: path.path };
      });
      if (entries.length) uploads.enqueue(entries, nodeId);
      setDropError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : t("fileUploadDropzone.errorUpload");
      setDropError(message.startsWith("storageUpload.") ? t(message) : message);
    }
  }, [canEdit, data.currentPath, data.nodeIdFilter, directUpload, t, uploads]);

  const submitSearch = () => {
    const query = searchInput.trim();
    if (!query) return;
    if (searchMode === "content") {
      contentSearch.run(query);
      return;
    }
    contentSearch.reset();
    void fetchFiles(data.currentPath, query, searchMode, data.nodeIdFilter, { resetSelection: true });
  };
  const clearSearch = () => {
    setSearchInput("");
    contentSearch.reset();
    if (data.searchQuery) void fetchFiles(data.currentPath, undefined, undefined, data.nodeIdFilter, { resetSelection: true });
  };

  const isFileDrag = (event: DragEvent) => event.dataTransfer.types.includes("Files");
  // Only search results can mix nodes; at the root every row is a node already.
  const showSource = Boolean(data.searchQuery) && (!data.nodeIdFilter || data.searchScope === "all");
  const sortKey = data.sort ?? "name";
  const sortDirection = data.direction ?? "asc";
  const changeSort = (sort: typeof sortKey, direction: typeof sortDirection) => {
    void fetchFiles(data.currentPath, data.searchQuery, data.searchScope, data.nodeIdFilter, { sort, direction, page: 1, resetSelection: true });
  };
  const contentActive = searchMode === "content" && (contentSearch.state.loading || Boolean(contentSearch.state.lastQuery));

  return (
    <>
      <input ref={fileInputRef} type="file" multiple hidden aria-hidden="true" tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void startUpload(() => files);
        }} />
      <input ref={folderInputRef} type="file" multiple hidden aria-hidden="true" tabIndex={-1}
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          event.currentTarget.value = "";
          void startUpload(() => files);
        }} />

      <div
        data-file-browser
        className="relative grid min-w-0 gap-4 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:items-start"
        onDragEnter={(event) => {
          if (!isFileDrag(event) || !canEdit) return;
          event.preventDefault();
          setDragDepth((depth) => depth + 1);
        }}
        onDragLeave={(event) => {
          if (!isFileDrag(event)) return;
          setDragDepth((depth) => Math.max(0, depth - 1));
        }}
        onDragOver={(event) => {
          if (isFileDrag(event)) event.preventDefault();
        }}
        onDrop={(event) => {
          if (!isFileDrag(event)) return;
          event.preventDefault();
          setDragDepth(0);
          const transfer = event.dataTransfer;
          void startUpload(() => readDroppedFiles(transfer));
        }}
      >
        <DriveSidebar
          t={t}
          data={data}
          mobileOpen={mobileSidebarOpen}
          expandedTreePaths={treeExpansion.paths}
          onToggleTreePath={toggleTreePath}
          onSelectNode={selectNode}
          onTreeNavigate={treeNavigate}
          onOpenCollection={(mode) => setCollection({ mode, key: Date.now() })}
        />

        <section data-list-panel aria-busy={loading} aria-label={t("filesPage.drive.listAria")} className="flex min-w-0 flex-col">
          <header data-list-panel-header className="flex flex-col gap-3 border-b border-[var(--border-subtle)] px-4 py-3 sm:px-5">
            {/* Wraps on phones: the location keeps the first line, the view controls move below it. */}
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-2">
              <div className="flex min-w-0 flex-1 basis-[13rem] items-center gap-2">
                <ActionButton
                  variant="ghost"
                  size="sm"
                  square
                  onClick={() => setMobileSidebarOpen((value) => !value)}
                  aria-expanded={mobileSidebarOpen}
                  aria-controls="files-browser-sidebar"
                  aria-label={mobileSidebarOpen ? t("filesBrowserSpa.collapseDirectoryTree") : t("filesBrowserSpa.expandDirectoryTree")}
                  title={mobileSidebarOpen ? t("filesBrowserSpa.collapseDirectoryTree") : t("filesBrowserSpa.expandDirectoryTree")}
                  className="-ml-1.5 lg:hidden"
                >
                  <IconPanelLeft aria-hidden />
                </ActionButton>
                <DriveBreadcrumbs
                  t={t}
                  path={data.currentPath}
                  nodes={data.nodes}
                  nodeIdFilter={data.nodeIdFilter}
                  onNavigate={navigateToFolder}
                  onRoot={() => selectNode("")}
                />
                {!contentActive && data.pagination ? (
                  <span className="inline-flex min-w-6 shrink-0 items-center justify-center rounded-full bg-[var(--surface-elevated)] px-2 py-0.5 text-xs font-medium tabular-nums text-[var(--text-secondary)]">
                    {data.pagination.totalItems}
                  </span>
                ) : null}
                {loading ? <Spinner size="sm" label={t("filesBrowserSpa.loading")} /> : null}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                {viewMode === "grid" ? <SortMenu sortKey={sortKey} sortDir={sortDirection} onChange={changeSort} showSource={showSource} /> : null}
                <ViewToggle />
                <IconButton
                  label={loading ? t("filesBrowserSpa.refreshing") : refreshLabel}
                  onClick={() => void refreshCurrentListing()}
                  disabled={loading}
                  className="shrink-0 disabled:opacity-60"
                >
                  <RefreshCw size={17} className={loading ? "animate-spin" : undefined} aria-hidden />
                </IconButton>
              </div>
            </div>
            <div data-toolbar className="flex flex-wrap items-center gap-2">
              <DriveSearchBar
                value={searchInput}
                onChange={setSearchInput}
                mode={searchMode}
                onModeChange={(mode) => {
                  setSearchMode(mode);
                  contentSearch.reset();
                }}
                onSubmit={submitSearch}
                inputRef={searchInputRef}
                busy={contentSearch.state.loading}
              />
              <div className="flex shrink-0 items-center gap-2 sm:ml-auto">
                <ActionButton
                  variant="secondary"
                  icon={<FolderPlus aria-hidden />}
                  disabled={!canEdit || uploadNodes.length === 0 || loading}
                  title={!canEdit ? t("filesBrowserSpa.cannotCreateFolderNoPermission") : uploadNodes.length === 0 ? t("filesBrowserSpa.cannotCreateFolderNoNode") : undefined}
                  onClick={() => setNewFolderOpen(true)}
                >
                  {t("common.newFolder")}
                </ActionButton>
                <UploadMenu
                  disabled={!canEdit || uploadNodes.length === 0 || loading}
                  onUploadFiles={() => {
                    if (directUpload) fileInputRef.current?.click();
                    else setUploadOpen(true);
                  }}
                  onUploadFolder={() => {
                    if (directUpload) folderInputRef.current?.click();
                    else setUploadOpen(true);
                  }}
                />
              </div>
            </div>
          </header>

          {data.searchQuery || contentActive ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-4 py-2 text-xs text-[var(--text-secondary)] sm:px-5">
              {data.searchQuery && !contentActive ? (
                <span>{t("filesBrowserSpa.searchResults", { query: data.searchQuery, scope: data.searchScope === "all" ? t("filesBrowserSpa.searchInAllFiles") : t("filesBrowserSpa.searchInCurrentFolder"), count: data.stats.totalItems })}</span>
              ) : (
                <span>{t("filesPage.drive.contentSearchFor", { query: contentSearch.state.lastQuery })}</span>
              )}
              <ActionButton size="xs" variant="ghost" icon={<X aria-hidden />} onClick={clearSearch}>{t("filesPage.drive.clearSearch")}</ActionButton>
            </div>
          ) : null}

          {dropError || listError ? (
            <div className="flex flex-col gap-2 px-4 pt-3 sm:px-5">
              {dropError ? <Notice tone="danger" onDismiss={() => setDropError("")} dismissLabel={t("common.close")}>{dropError}</Notice> : null}
              {listError ? <KnownErrorNotice tone={data.syncWarning === listError ? "warning" : "danger"} raw={listError} /> : null}
            </div>
          ) : null}

          {contentActive ? (
            <div className="flex flex-col gap-3 px-4 py-3 sm:px-5">
              {contentSearch.state.loading ? <Spinner size="sm" label={t("filesBrowserSpa.contentSearching")} /> : null}
              <ContentSearchResults
                state={contentSearch.state}
                onOpen={(hit) => {
                  contentSearch.reset();
                  setSearchMode("current");
                  const folder = hit.relativePath.split("/").slice(0, -1).join("/");
                  void fetchFiles(folder, undefined, undefined, hit.nodeId, { resetSelection: true, history: "push" });
                }}
              />
            </div>
          ) : (
            <FileListClient
              selectionScopeSeed={`${selectionEpoch}\u0000${data.currentPath}\u0000${data.searchQuery}\u0000${data.searchScope}\u0000${data.nodeIdFilter ?? ""}`}
              selectionPage={data.pagination?.page}
              serverSort={data.pagination ? { key: sortKey, dir: sortDirection, onChange: changeSort } : undefined}
              folders={data.folders}
              files={data.files}
              canEditLocalFiles={data.permissions.canEditLocalFiles}
              canDelete={data.permissions.canDelete}
              canShare={data.permissions.canShare}
              currentPath={data.currentPath}
              searchQuery={data.searchQuery}
              nodeIdFilter={data.nodeIdFilter}
              showSource={showSource}
              nodes={data.nodes}
              onFolderClick={navigateToFolder}
              onRefresh={refreshCurrentListing}
            />
          )}

          {/* The header counts the items; a footer only appears to page through them. */}
          {!contentActive && data.pagination && (data.pagination.totalItems > data.pagination.pageSize || data.pagination.page > 1) ? (
            <footer className="mt-auto border-t border-[var(--border-subtle)] px-4 py-2 sm:px-5">
              <Pagination page={data.pagination.page} pageSize={data.pagination.pageSize} totalItems={data.pagination.totalItems} loading={loading}
                onPageChange={(page) => { void fetchFiles(data.currentPath, data.searchQuery, data.searchScope, data.nodeIdFilter, { page, history: "push" }); }}
                onPageSizeChange={(pageSize) => { void fetchFiles(data.currentPath, data.searchQuery, data.searchScope, data.nodeIdFilter, { page: 1, pageSize, resetSelection: true }); }}
              />
            </footer>
          ) : null}
        </section>

        {dragDepth > 0 ? (
          <div data-dropzone="" data-drag-over="" aria-hidden="true" className="pointer-events-none absolute inset-2 z-20 !min-h-0 shadow-[var(--shadow-lg)]">
            <Upload aria-hidden />
            <span className="text-sm font-medium">
              {directUpload
                ? t("filesPage.drive.dropToUpload", { path: currentPathDisplay.uploadPathLabel })
                : t("filesPage.drive.dropChooseNode")}
            </span>
          </div>
        ) : null}
      </div>

      {children}

      {canEdit ? (
        <Dialog
          size="2xl"
          open={uploadOpen}
          onClose={() => {
            setUploadOpen(false);
            setPendingUploadFiles([]);
          }}
          title={t("filesBrowserSpa.uploadToPath", { path: currentPathDisplay.uploadPathLabel })}
          description={t("filesBrowserSpa.uploadDescription")}
        >
          <FileUploadDropzoneLazy
            nodes={data.nodes}
            initialNodeId={preferredUploadNode}
            initialRelativeDir={data.nodeIdFilter ? data.currentPath : ""}
            uploadDir={data.nodeIdFilter ? data.currentPath : undefined}
            title={t("filesBrowserSpa.uploadToPath", { path: currentPathDisplay.uploadPathLabel })}
            description={t("filesBrowserSpa.uploadDescription")}
            submitLabel={t("filesBrowserSpa.uploadSubmitLabel")}
            pathLabel={t("filesBrowserSpa.uploadPathLabel")}
            allowNodeSelection={true}
            embedded
            pendingFiles={pendingUploadFiles}
            onPendingFilesUsed={() => setPendingUploadFiles([])}
            onUploadComplete={() => refreshCurrentListing()}
          />
        </Dialog>
      ) : null}

      {newFolderOpen ? (
        <NewFolderDialog
          onClose={() => setNewFolderOpen(false)}
          nodes={data.nodes}
          nodeId={data.nodeIdFilter}
          currentPath={data.currentPath}
          onCreated={() => void refreshCurrentListing()}
        />
      ) : null}

      {collection ? (
        <FileCollectionsDialog key={collection.key} open initialMode={collection.mode} onClose={() => setCollection(null)} />
      ) : null}
    </>
  );
}
