"use client";

import { useState, useCallback } from "react";

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
import { ModalShell } from "@/components/modal-shell";

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
}: {
  initialData: FilesApiResponse;
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

  const { navigateToFolder } = useFolderNavigation(fetchFiles);

  const uploadNodes = data.nodes.filter(
    (n) => n.driver === "LOCAL" || n.driver === "SFTP",
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
  const [expandedTreePaths, setExpandedTreePaths] = useState<Set<string>>(() =>
    getInitialExpandedTreePaths(initialData.tree, initialData.currentPath),
  );
  const toggleTreePath = useCallback((path: string) => {
    setExpandedTreePaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
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
    <section className="mt-8 grid min-w-0 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">
      {/* Mobile-only sidebar toggle (hidden on xl+) */}
      <button
        type="button"
        onClick={() => setMobileSidebarOpen((value) => !value)}
        aria-expanded={mobileSidebarOpen}
        aria-controls="files-browser-sidebar"
        className="flex min-h-11 w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-2.5 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--surface-hover)] active:bg-[var(--surface-elevated)] xl:hidden"
      >
        <span>{mobileSidebarOpen ? t("filesBrowserSpa.collapseDirectoryTree") : t("filesBrowserSpa.expandDirectoryTree")}</span>
        <span aria-hidden="true" className="text-xs">
          {mobileSidebarOpen ? "▴" : "▾"}
        </span>
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
      <section className="min-w-0 space-y-5">
        {/* Search + Toolbar */}
        <article className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-[var(--shadow-sm)] sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">
                {currentPathDisplay.title}
                {loading ? (
                  <span className="ml-2 text-sm text-[var(--accent)] animate-pulse">
                    {t("filesBrowserSpa.loading")}
                  </span>
                ) : null}
              </h2>
              <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">
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
            searchInput={searchInput}
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
              }} className="mt-2 !text-xs"
            >
              {t("filesBrowserSpa.clear")}
            </ActionButton>
          ) : null}

          <div data-tone="cyan" className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-[var(--shadow-sm)]">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="text-xl font-semibold text-[var(--text-primary)]">
                  {t("filesBrowserSpa.currentDirectoryOps")}
                </h3>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {t("filesBrowserSpa.currentPathPrefix")}{currentPathDisplay.label}
                </p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {t("filesBrowserSpa.itemCountWithSource", { count: data.stats.totalItems, sources: data.sourceSummary.join(t("filesBrowserSpa.sourceListSeparator")) })}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <ActionButton variant="success"
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
                  {loading ? t("filesBrowserSpa.refreshing") : `↻ ${refreshLabel}`}
                </ActionButton>
                {data.permissions.canEditLocalFiles ? (
                  <button
                    type="button"
                    onClick={() => setUploadOpen(true)}
                    disabled={loading}
                    data-action-button
                    data-variant="primary"
                    aria-haspopup="dialog"
                    className="px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {t("filesBrowserSpa.uploadFiles")}
                  </button>
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
          </div>

          {/* File list with batch operations */}
          {listError ? (
            <div
              role="alert"
              data-tone="amber" className="mt-4 rounded-lg border border-[var(--warning-border)] px-4 py-3 text-sm text-[var(--warning)]"
            >
              {data.syncWarning === listError
                ? t("filesBrowserSpa.remoteSyncNotice")
                : t("filesBrowserSpa.fileListRefreshFailed")}
              : {listError}
            </div>
          ) : null}
          <FileListClient
            selectionScopeSeed={`${selectionEpoch}\u0000${data.currentPath}\u0000${data.searchQuery}\u0000${data.searchScope}\u0000${data.nodeIdFilter ?? ""}`}
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
        </article>

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
              <ActionButton variant="ghost" onClick={() => setUploadOpen(false)} aria-label={t("common.close")} className="!px-2 !py-1">
                <span aria-hidden="true">✕</span>
              </ActionButton>
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
  );
}
