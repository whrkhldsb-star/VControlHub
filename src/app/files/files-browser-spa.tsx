"use client";

import { useState, useCallback } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { FileListClient } from "./file-list-client";
import { SearchScopeToggle } from "./search-scope-toggle";
import { ContentSearchPanel } from "./content-search-panel";
import { FileUploadDropzoneLazy } from "./file-upload-dropzone-lazy";
import { CreateFolderForm } from "./create-folder-form";
import { RecycleBinSectionClientLazy } from "./recycle-bin-section-client-lazy";
import { useFileBrowserListing } from "./use-file-browser-listing";
import {
  type FilesApiResponse,
  type DeletedEntryProp,
  getInitialExpandedTreePaths,
  getCurrentPathDisplay,
  getNodeById,
} from "./files-browser-helpers";
import { BreadcrumbsClient } from "./breadcrumbs-client";
import { RecentDownloadsPanel } from "./recent-downloads-panel";
import { FilesBrowserSidebar } from "./files-browser-sidebar";

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

  const navigateToNodeFolder = useCallback(
    (path: string, nodeId: string) => {
      fetchFiles(path, undefined, undefined, nodeId, {
        resetSelection: true,
        history: "push",
      });
    },
    [fetchFiles],
  );

  return { navigateToFolder, navigateToNodeFolder };
}

/* ── Main Component ─────────────────────────────────────────────── */

export function FilesBrowserSpa({
  initialData,
  deletedEntries,
}: {
  initialData: FilesApiResponse;
  deletedEntries: DeletedEntryProp[];
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
    handleSearch,
    handleScopeChange,
  } = useFileBrowserListing({ initialData });
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  const { navigateToFolder, navigateToNodeFolder } = useFolderNavigation(fetchFiles);

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

  // Node filter handler
  const handleNodeFilterChange = useCallback(
    (newNodeId: string) => {
      // Reset to root path when switching nodes
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

      {/* Main content area */}
      <section className="min-w-0 space-y-5">
        <RecentDownloadsPanel onNavigate={navigateToNodeFolder} />

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
            </div>
            <BreadcrumbsClient
              t={t}
              path={data.currentPath}
              nodes={data.nodes}
              onNavigate={navigateToFolder}
            />
          </div>

          {/* Search bar */}
          <form onSubmit={handleSearch} className="mt-4">
            <input type="hidden" name="scope" value={data.searchScope} />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <SearchScopeToggle
                scope={data.searchScope}
                currentPath={data.currentPath}
                onScopeChange={handleScopeChange}
              />
              <div className="flex flex-1 flex-col gap-1 sm:flex-row sm:items-end sm:gap-3">
                <div className="flex flex-1 flex-col gap-1">
                  <label htmlFor="files-search-query" className="text-xs font-medium text-[var(--text-secondary)]">
                    {t("filesBrowserSpa.searchFileName")}
                  </label>
                  <input
                    id="files-search-query"
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.currentTarget.value)}
                    placeholder={
                      data.searchScope === "all"
                        ? t("filesBrowserSpa.searchAllFiles")
                        : t("filesBrowserSpa.searchCurrentFolder")
                    }
                    data-input className="rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-border)] focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  data-action-button data-variant="primary" className="px-5 py-2.5 text-sm"
                >
                  {t("filesBrowserSpa.searchLabel")}
                </button>
                {data.searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      fetchFiles(data.currentPath);
                    }}
                    className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-5 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)]"
                  >
                    {t("filesBrowserSpa.clear")}
                  </button>
                ) : null}
              </div>
            </div>
            {data.searchQuery ? (
              <p className="mt-2 text-xs text-[var(--text-secondary)]">
                {t("filesBrowserSpa.searchResults")
                  .replace("{query}", data.searchQuery)
                  .replace("{scope}", data.searchScope === "all" ? t("filesBrowserSpa.searchInAllFiles") : t("filesBrowserSpa.searchInCurrentFolder"))
                  .replace("{count}", String(data.stats.totalItems))}
              </p>
            ) : null}
          </form>

          {/* FEAT-P0-4: Content search panel */}
          <div className="mt-4">
            <ContentSearchPanel
              searchInput={searchInput}
              nodeId={data.nodeIdFilter || undefined}
              searchPath={data.currentPath || undefined}
            />
          </div>

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
                  {t("filesBrowserSpa.itemCountWithSource")
                    .replace("{count}", String(data.stats.totalItems))
                    .replace("{sources}", data.sourceSummary.join(t("filesBrowserSpa.sourceListSeparator")))}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() =>
                    fetchFiles(
                      data.currentPath,
                      data.searchQuery,
                      data.searchScope,
                      data.nodeIdFilter,
                    )
                  }
                  disabled={loading}
                  data-tone="emerald" className="rounded-lg border border-[var(--success-border)] px-4 py-2 text-sm font-medium text-[var(--success)] transition hover:bg-[var(--success-bg)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? t("filesBrowserSpa.refreshing") : `↻ ${refreshLabel}`}
                </button>
                {data.permissions.canEditLocalFiles ? (
                  <a
                    href="#upload-section"
                    data-tone="accent"
                    className="rounded-lg border px-4 py-2 text-sm font-medium transition"
                  >
                    {t("filesBrowserSpa.uploadFiles")}
                  </a>
                ) : null}
                {data.permissions.canEditLocalFiles && data.nodes.length > 0 ? (
                  <CreateFolderForm
                    storageNodes={data.nodes}
                    currentPath={data.currentPath}
                    initialNodeId={data.nodeIdFilter || undefined}
                    onCreated={() =>
                      fetchFiles(
                        data.currentPath,
                        data.searchQuery,
                        data.searchScope,
                        data.nodeIdFilter,
                      )
                    }
                  />
                ) : (
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    title={
                      !data.permissions.canEditLocalFiles
                        ? t("filesBrowserSpa.cannotCreateFolderNoPermission")
                        : t("filesBrowserSpa.cannotCreateFolderNoNode")
                    }
                    className="cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-4 py-2 text-sm font-medium text-[var(--text-secondary)]"
                  >
                    {t("filesBrowserSpa.createFolder")}
                  </button>
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
            onRefresh={() =>
              fetchFiles(
                data.currentPath,
                data.searchQuery,
                data.searchScope,
                data.nodeIdFilter,
              )
            }
          />
        </article>

        {/* Upload section — TR-036 lazy chunk, only fetched when canEditLocalFiles */}
        {data.permissions.canEditLocalFiles ? (
          <div id="upload-section">
            <FileUploadDropzoneLazy
              nodes={data.nodes}
              initialNodeId={preferredUploadNode}
              initialRelativeDir={data.currentPath}
              uploadDir={data.currentPath}
              title={t("filesBrowserSpa.uploadToPath").replace("{path}", currentPathDisplay.uploadPathLabel)}
              description={t("filesBrowserSpa.uploadDescription")}
              submitLabel={t("filesBrowserSpa.uploadSubmitLabel")}
              pathLabel={t("filesBrowserSpa.uploadPathLabel")}
              allowNodeSelection={true}
              onUploadComplete={() =>
                fetchFiles(
                  data.currentPath,
                  data.searchQuery,
                  data.searchScope,
                  data.nodeIdFilter,
                )
              }
            />
          </div>
        ) : null}

        {/* Recycle bin — TR-036 lazy chunk, fetched on first view */}
        <RecycleBinSectionClientLazy
          deletedEntries={deletedEntries}
          canDelete={data.permissions.canDelete}
          onRefresh={() =>
            fetchFiles(
              data.currentPath,
              data.searchQuery,
              data.searchScope,
              data.nodeIdFilter,
            )
          }
        />
      </section>
    </section>
  );
}
