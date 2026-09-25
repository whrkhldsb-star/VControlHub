"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import Link from "next/link";

import { useI18n } from "@/lib/i18n/use-locale";
import { FileListClient } from "./file-list-client";
import { UnifiedFileSearch } from "./unified-file-search";
import { FileUploadDropzoneLazy } from "./file-upload-dropzone-lazy";
import { CreateFolderForm } from "./create-folder-form";
import { useFileBrowserListing } from "./use-file-browser-listing";
import {
  type FilesApiResponse,
  getInitialExpandedTreePaths,
  getCurrentPathDisplay,
  getNodeById,
} from "./files-browser-helpers";
import { BreadcrumbsClient } from "./breadcrumbs-client";
import { FilesBrowserSidebar } from "./files-browser-sidebar";
import { ActionButton } from "@/components/action-button";
import { Notice, Spinner } from "@/components/ui-primitives";
import { ModalShell } from "@/components/modal-shell";
import { Pagination } from "@/components/pagination";
import { ChevronRight, Plus, RefreshCw, X } from "@/components/icons";
import { IconButton } from "@/components/ui-primitives";
import { StatCard, StatGrid, Toolbar } from "@/components/page-shell";
import { describeKnownError } from "@/lib/ui/known-error-copy";
import { useStorageUploads } from "@/components/storage/storage-upload-provider";
import { readDroppedFiles } from "@/components/storage/storage-drop-files";
import { getBrowserRelativePath, normalizeRelativePath } from "@/components/storage/file-upload-helpers";

/* ── Navigation hook ────────────────────────────────────────────── */

type FetchFilesOptions = {
  resetSelection?: boolean;
  history?: "push" | "replace" | "none";
};

function useFolderNavigation(
  fetchFiles: (
    path: string,
    q?: string,
    scope?: string,
    nodeId?: string,
    options?: FetchFilesOptions,
  ) => Promise<void>,
) {
  const navigateToFolder = useCallback(
    (path: string) => {
      fetchFiles(path, undefined, undefined, undefined, {
        resetSelection: true,
        history: "push",
      });
    },
    [fetchFiles],
  );

  return { navigateToFolder };
}

/* ── Main Component ─────────────────────────────────────────────── */

export function FilesBrowserSpa({
  initialData,
  children,
}: {
  initialData: FilesApiResponse;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  // Listing state (data / loading / listError / search / selection epoch /
  // popstate listener) is owned by the hook (R25).  The mobile sidebar
  // toggle stays here because the rendering is part of the page shell
  // rather than the listing flow.
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
  const uploads = useStorageUploads();
  const [dropError, setDropError] = useState("");
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Keep the browser feeling like a desktop drive: `/` focuses search and
  // Escape closes transient UI. Ignore shortcuts while typing in another
  // control so normal file-name entry is never interrupted.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editing = target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]');
      if (event.defaultPrevented || event.isComposing || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "/" && !editing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        if (mobileSidebarOpen) setMobileSidebarOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileSidebarOpen]);

  const { navigateToFolder } = useFolderNavigation(fetchFiles);

  const uploadNodes = data.nodes.filter(
    (n) => n.driver === "LOCAL" || n.driver === "SFTP" || n.driver === "WEBDAV",
  );
  const currentPathDisplay = getCurrentPathDisplay(
    t,
    data.currentPath,
    data.nodes,
    data.nodeIdFilter,
  );
  const selectedNode = getNodeById(data.nodes, data.nodeIdFilter);
  const preferredUploadNode = data.nodeIdFilter && uploadNodes.some((node) => node.id === data.nodeIdFilter)
    ? data.nodeIdFilter
    : uploadNodes[0]?.id ?? data.nodes[0]?.id;
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
  const expandedTreePaths = treeExpansion.paths;
  const toggleTreePath = useCallback((path: string) => {
    setTreeExpansion((current) => {
      const next = new Set(current.paths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return { ...current, paths: next };
    });
  }, []);
  const refreshCurrentListing = useCallback(
    () =>
      fetchFiles(
        data.currentPath,
        data.searchQuery,
        data.searchScope,
        data.nodeIdFilter,
      ),
    [
      data.currentPath,
      data.nodeIdFilter,
      data.searchQuery,
      data.searchScope,
      fetchFiles,
    ],
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

  // Node filter handler
  const handleNodeFilterChange = useCallback(
    (newNodeId: string) => {
      // Reset to root path when switching nodes
      setUploadOpen(false);
      fetchFiles("", data.searchQuery, data.searchScope, newNodeId, {
        resetSelection: true,
      });
    },
    [fetchFiles, data.searchQuery, data.searchScope],
  );

  // Tree navigation handler — closes the mobile sidebar after navigation
  // so the user can see the file list on small viewports.
  const handleTreeNavigate = useCallback(
    (path: string) => {
      fetchFiles(path, undefined, undefined, undefined, {
        resetSelection: true,
        history: "push",
      });
      setMobileSidebarOpen(false);
    },
    [fetchFiles],
  );

  return (
    <>
    <StatGrid>
      <StatCard label={t("filesPage.statTotalNodes")} value={data.stats.totalNodes} />
      <StatCard label={t("filesPage.statActiveFiles")} value={data.stats.totalEntries} />
      <StatCard label={t("filesPage.statCurrentDirectory")} value={data.stats.totalItems} />
      <Link href="/files/recycle-bin" data-stat-card data-card className="transition hover:bg-[var(--surface-hover)]">
        <div className="text-xs font-medium text-[var(--text-muted)]">{t("filesPage.statRecycleBin")}</div>
        <div className="mt-2 text-2xl font-semibold tabular-nums">{data.stats.deletedEntries}</div>
      </Link>
    </StatGrid>
    {children}
    {dropError ? <Notice tone="danger">{dropError}</Notice> : null}
    <section className="mt-6 grid min-w-0 gap-5 xl:grid-cols-[240px_minmax(0,1fr)]"
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
      onDrop={async (event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        const nodeId = data.nodeIdFilter;
        const directory = data.currentPath;
        try {
          if (!data.permissions.canEditLocalFiles) throw new Error(t("filesBrowserSpa.cannotCreateFolderNoPermission"));
          if (!nodeId) throw new Error(t("fileUploadDropzone.errorNoNode"));
          const files = await readDroppedFiles(event.dataTransfer);
          const entries = files.map((file) => {
            const path = normalizeRelativePath([directory, getBrowserRelativePath(file)].filter(Boolean).join("/"));
            if (!path.ok) throw new Error(t(`fileUploadDropzone.pathError.${path.reason}`));
            return { file, path: path.path };
          });
          uploads.enqueue(entries, nodeId);
          setDropError("");
        } catch (error) {
          const message = error instanceof Error ? error.message : t("fileUploadDropzone.errorUpload");
          setDropError(message.startsWith("storageUpload.") ? t(message) : message);
        }
      }}>
      {/* Mobile-only sidebar toggle (hidden on xl+) */}
      <button
        type="button"
        onClick={() => setMobileSidebarOpen((value) => !value)}
        aria-expanded={mobileSidebarOpen}
        aria-controls="files-browser-sidebar"
        className="flex min-h-11 w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-elevated)] xl:hidden"
      >
        <span>{mobileSidebarOpen ? t("filesBrowserSpa.collapseDirectoryTree") : t("filesBrowserSpa.expandDirectoryTree")}</span>
        <ChevronRight size={18} aria-hidden className={mobileSidebarOpen ? "-rotate-90" : "rotate-90"} />
      </button>
      {/* Sidebar: Directory tree */}
      <FilesBrowserSidebar
        t={t}
        data={data}
        mobileSidebarOpen={mobileSidebarOpen}
        expandedTreePaths={expandedTreePaths}
        onToggleTreePath={toggleTreePath}
        onNodeFilterChange={handleNodeFilterChange}
        onTreeNavigate={handleTreeNavigate}
      />

      {/* Main content area — cloud-drive style browser only */}
      <section data-file-browser className="min-w-0 space-y-5">
        {/* Search + Toolbar */}
        <div className="min-w-0">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <h2 className="break-words text-base font-semibold text-[var(--text-primary)]">
                {currentPathDisplay.title}
                {loading ? (
                  <span className="ml-2 inline-flex items-center gap-2 align-middle text-sm text-[var(--text-muted)]">
                    <Spinner size="sm" label={t("filesBrowserSpa.loading")} />
                    <span aria-hidden>{t("filesBrowserSpa.loading")}</span>
                  </span>
                ) : null}
              </h2>
              <p className="mt-1 break-all text-xs leading-5 text-[var(--text-secondary)]">
                {currentPathDisplay.label ? t("filesBrowserSpa.currentPathPrefix") + currentPathDisplay.label : t("filesBrowserSpa.currentPathAllNodes")}
              </p>
              {selectedNode?.driver === "LOCAL" && selectedNode.basePath ? (
                <p className="mt-1 break-all text-xs text-[var(--text-muted)]">
                  {t("filesBrowserSpa.localDiskPath", { path: selectedNode.basePath })}
                </p>
              ) : null}
            </div>
            <BreadcrumbsClient
              t={t}
              path={data.currentPath}
              nodes={data.nodes}
              onNavigate={navigateToFolder}
            />
          </div>

          {/* Unified search bar (replaces old split scope toggle + content panel) */}
          <UnifiedFileSearch
            key={`${data.nodeIdFilter}:${data.currentPath}:${data.searchScope}`}
            initialScope={data.searchScope}
            searchInput={searchInput}
            inputRef={searchInputRef}
            onSearchInputChange={setSearchInput}
            onFilenameSearch={(scope) => {
              void fetchFiles(data.currentPath, searchInput, scope, data.nodeIdFilter, {
                resetSelection: true,
              });
            }}
            nodeId={data.nodeIdFilter || undefined}
            searchPath={data.currentPath || undefined}
          />

          {data.searchQuery ? (
            <p className="mt-2 text-xs text-[var(--text-secondary)]">
              {t("filesBrowserSpa.searchResults", { query: data.searchQuery, scope: data.searchScope === "all" ? t("filesBrowserSpa.searchInAllFiles") : t("filesBrowserSpa.searchInCurrentFolder"), count: data.stats.totalItems })}
            </p>
          ) : null}
          {data.searchQuery ? (
            <ActionButton variant="secondary"
              onClick={() => {
                setSearchInput("");
                fetchFiles(data.currentPath);
              }} className="mt-2 !text-sm"
            >
              {t("filesBrowserSpa.clear")}
            </ActionButton>
          ) : null}

          <Toolbar className="mt-4 !mb-0 border-t pt-3">
            <div className="flex w-full min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-secondary)]">
                  {t("filesBrowserSpa.itemCountWithSource", { count: data.stats.totalItems, sources: data.sourceSummary.join(t("filesBrowserSpa.sourceListSeparator")) })}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <IconButton label={loading ? t("filesBrowserSpa.refreshing") : refreshLabel}
                  onClick={() =>
                    fetchFiles(
                      data.currentPath,
                      data.searchQuery,
                      data.searchScope,
                      data.nodeIdFilter,
                    )
                  }
                  disabled={loading} className="disabled:opacity-60"
                >
                  <RefreshCw size={18} className={loading ? "animate-spin" : undefined} aria-hidden />
                </IconButton>
                {data.permissions.canEditLocalFiles ? (
                  <ActionButton
                    type="button"
                    onClick={() => setUploadOpen(true)}
                    disabled={loading}
                    variant="primary"
                    aria-haspopup="dialog"
                    className="px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus size={18} aria-hidden />
                    {t("filesBrowserSpa.uploadFiles")}
                  </ActionButton>
                ) : null}
                {data.permissions.canEditLocalFiles && data.nodes.length > 0 ? (
                  <CreateFolderForm
                    storageNodes={data.nodes}
                    currentPath={data.currentPath}
                    initialNodeId={data.nodeIdFilter || undefined}
                    disabled={loading}
                    onCreated={refreshCurrentListing}
                  />
                ) : (
                  <ActionButton variant="secondary"
                    disabled
                    aria-disabled="true"
                    title={
                      !data.permissions.canEditLocalFiles
                        ? t("filesBrowserSpa.cannotCreateFolderNoPermission")
                        : t("filesBrowserSpa.cannotCreateFolderNoNode")
                    } className="cursor-not-allowed opacity-60"
                  >
                    {t("filesBrowserSpa.createFolder")}
                  </ActionButton>
                )}
              </div>
            </div>
          </Toolbar>

          {/* File list with batch operations */}
          {listError ? <KnownErrorNotice tone={data.syncWarning === listError ? "warning" : "danger"} raw={listError} className="mt-4" /> : null}
          <FileListClient
            selectionScopeSeed={`${selectionEpoch}\u0000${data.currentPath}\u0000${data.searchQuery}\u0000${data.searchScope}\u0000${data.nodeIdFilter ?? ""}`}
            selectionPage={data.pagination?.page}
            serverSort={data.pagination ? {key:data.sort ?? "name",dir:data.direction ?? "asc",onChange:(sort,direction) => {
              void fetchFiles(data.currentPath,data.searchQuery,data.searchScope,data.nodeIdFilter,{sort,direction,page:1,resetSelection:true});
            }} : undefined}
            folders={data.folders}
            files={data.files}
            canEditLocalFiles={data.permissions.canEditLocalFiles}
            canDelete={data.permissions.canDelete}
            canShare={data.permissions.canShare}
            currentPath={data.currentPath}
            searchQuery={data.searchQuery}
            onFolderClick={navigateToFolder}
            onRefresh={refreshCurrentListing}
          />
          {data.pagination ? <Pagination page={data.pagination.page} pageSize={data.pagination.pageSize} totalItems={data.pagination.totalItems} loading={loading}
            onPageChange={(page) => { void fetchFiles(data.currentPath,data.searchQuery,data.searchScope,data.nodeIdFilter,{page,history:"push"}); }}
            onPageSizeChange={(pageSize) => { void fetchFiles(data.currentPath,data.searchQuery,data.searchScope,data.nodeIdFilter,{page:1,pageSize,resetSelection:true}); }}
          /> : null}
        </div>

        {/* Keep the expensive upload widget out of the browsing flow until requested. */}
        {data.permissions.canEditLocalFiles ? (
          <ModalShell
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            labelledBy="files-upload-dialog-title"
            panelClassName="max-h-[calc(100dvh-2rem)] w-full max-w-3xl overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--modal-bg)] p-4 shadow-2xl sm:p-5"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 id="files-upload-dialog-title" className="text-lg font-semibold text-[var(--text-primary)]">
                  {t("filesBrowserSpa.uploadToPath", { path: currentPathDisplay.uploadPathLabel })}
                </h2>
                <p className="mt-1 text-sm text-[var(--text-muted)]">{t("filesBrowserSpa.uploadDescription")}</p>
              </div>
              <IconButton onClick={() => setUploadOpen(false)} label={t("common.close")}><X size={18} aria-hidden /></IconButton>
            </div>
            <FileUploadDropzoneLazy
              nodes={data.nodes}
              initialNodeId={preferredUploadNode}
              initialRelativeDir={data.currentPath}
              uploadDir={data.currentPath}
              title={t("filesBrowserSpa.uploadToPath", { path: currentPathDisplay.uploadPathLabel })}
              description={t("filesBrowserSpa.uploadDescription")}
              submitLabel={t("filesBrowserSpa.uploadSubmitLabel")}
              pathLabel={t("filesBrowserSpa.uploadPathLabel")}
              allowNodeSelection={true}
              embedded
              onUploadComplete={() => {
                return fetchFiles(
                  data.currentPath,
                  data.searchQuery,
                  data.searchScope,
                  data.nodeIdFilter,
                );
              }}
            />
          </ModalShell>
        ) : null}
      </section>
    </section>
    </>
  );
}

function KnownErrorNotice({ tone, raw, className }: { tone: "warning" | "danger"; raw: string; className?: string }) {
	const { t } = useI18n();
	const { summary, detail } = describeKnownError(raw, t);
	return (
		<Notice tone={tone} className={className}>
			{summary}
			<code className="mt-1 block break-all font-mono text-xs opacity-80">{detail}</code>
		</Notice>
	);
}
