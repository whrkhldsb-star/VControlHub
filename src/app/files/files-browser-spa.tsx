"use client";

import { useState, useCallback, useMemo, useId } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import {
  FileListClient,
  type FolderProp,
  type FileProp,
} from "./file-list-client";
import { SearchScopeToggle } from "./search-scope-toggle";
import { FileUploadDropzoneLazy } from "./file-upload-dropzone-lazy";
import { CreateFolderForm } from "./create-folder-form";
import { RecycleBinSectionClientLazy } from "./recycle-bin-section-client-lazy";
import { useFileBrowserListing } from "./use-file-browser-listing";

/* ── Types ──────────────────────────────────────────────────────── */

type TreeNode = {
  name: string;
  displayName?: string;
  path: string;
  entryId?: string | null;
  fileCount: number;
  folderCount: number;
  sourceKeys: string[];
  sourceValues: string[];
  children: TreeNode[] | null;
};

type TreeRootNode = {
  name: string;
  path: string;
  fileCount?: number;
  folderCount?: number;
  sourceKeys?: string[];
  sourceValues?: string[];
  children: TreeNode[] | null;
};

type FilesApiResponse = {
  currentPath: string;
  nodeIdFilter: string;
  folders: FolderProp[];
  files: FileProp[];
  tree: TreeRootNode;
  stats: {
    totalNodes: number;
    defaultNodeName: string;
    localNodeCount: number;
    sftpNodeCount: number;
    totalEntries: number;
    previewableEntries: number;
    deletedEntries: number;
    remoteDirectoryCount: number;
    totalItems: number;
  };
  sourceSummary: string[];
  searchQuery: string;
  searchScope: "current" | "all";
  syncWarning?: string | null;
  permissions: {
    canEditLocalFiles: boolean;
    canDelete: boolean;
    canShare?: boolean;
    canManageNodes: boolean;
  };
  nodes: { id: string; name: string; driver: string }[];
};

type DeletedEntryProp = {
  id: string;
  name: string;
  entryType: string;
  relativePath: string;
  size: number | bigint | null;
};

/* ── Helpers ────────────────────────────────────────────────────── */

function splitPath(path: string) {
  return path ? path.split("/").filter(Boolean) : [];
}

function treePathMatchesCurrentPath(treePath: string, currentPath: string) {
  const normalizedTreePath = treePath.replace(/^\/+|\/+$/g, "");
  const normalizedCurrentPath = currentPath.replace(/^\/+|\/+$/g, "");
  if (!normalizedCurrentPath) return false;
  return (
    normalizedTreePath === normalizedCurrentPath ||
    normalizedTreePath.endsWith(`/${normalizedCurrentPath}`)
  );
}

function getInitialExpandedTreePaths(tree: TreeRootNode, currentPath: string) {
  const expanded = new Set<string>();
  const directSegments = splitPath(currentPath);
  directSegments.forEach((_, index) =>
    expanded.add(directSegments.slice(0, index + 1).join("/")),
  );

  function visit(node: TreeRootNode | TreeNode, ancestors: string[]): boolean {
    if (treePathMatchesCurrentPath(node.path, currentPath)) {
      ancestors.forEach((path) => expanded.add(path));
      expanded.add(node.path);
      return true;
    }

    const childMatches =
      node.children?.some((child) =>
        visit(child, [...ancestors, node.path].filter(Boolean)),
      ) ?? false;
    if (childMatches && node.path) expanded.add(node.path);
    return childMatches;
  }

  visit(tree, []);
  return expanded;
}

type NodeOption = { id: string; name: string; driver: string };

function parseNodeGroupSegment(segment: string) {
  const [label, idPrefix] = segment.split("__");
  return idPrefix ? { label, idPrefix } : null;
}

function isNodeGroupSegment(segment: string) {
  return parseNodeGroupSegment(segment) !== null;
}

function getNodeById(nodes: NodeOption[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId);
}

function getNodeFromGroupSegment(nodes: NodeOption[], segment: string) {
  const group = parseNodeGroupSegment(segment);
  if (!group) return null;
  return nodes.find((node) => node.id.startsWith(group.idPrefix)) ?? null;
}

function getDisplaySegment(segment: string, nodes: NodeOption[] = []) {
  const group = parseNodeGroupSegment(segment);
  if (!group) return segment;
  const node = getNodeFromGroupSegment(nodes, segment);
  return node ? node.name : group.label;
}

function getCurrentPathDisplay(t: (k: string) => string, path: string, nodes: NodeOption[], nodeIdFilter: string) {
  const selectedNode = getNodeById(nodes, nodeIdFilter);
  const segments = splitPath(path);
  const groupSegment = segments.find(isNodeGroupSegment);
  const groupNode = groupSegment ? getNodeFromGroupSegment(nodes, groupSegment) : null;
  const remotePathSegments = selectedNode
    ? segments
    : segments.filter((segment) => !isNodeGroupSegment(segment));
  const remotePath = remotePathSegments.map((segment) => getDisplaySegment(segment, nodes)).join("/");
  const nodeLabel = selectedNode
    ? `${selectedNode.name}（${selectedNode.driver}）`
    : groupNode
      ? `${groupNode.name}（${groupNode.driver}）`
      : groupSegment
        ? getDisplaySegment(groupSegment, nodes)
        : t("filesBrowserSpa.allNodes");
  return {
    title: selectedNode?.name ?? groupNode?.name ?? (remotePath || t("filesBrowserSpa.allFiles")),
    label: `${nodeLabel}：/${remotePath}`,
    uploadPathLabel: `/${remotePath}`,
  };
}

function getNodeIcon(driver: string) {
  return driver === "SFTP" ? "🖥" : "💾";
}

function getNodeLabel(t: (k: string) => string, node?: NodeOption) {
  if (!node) return t("filesBrowserSpa.allNodes");
  return `${node.name}（${node.driver}）`;
}

function NodeFilterSelect({
  t,
  nodes,
  value,
  onChange,
  compact = false,
}: {
  t: (k: string) => string;
  nodes: NodeOption[];
  value: string;
  onChange: (nodeId: string) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
  const searchInputId = useId();
  const selectInputId = useId();
  const selectedNode = nodes.find((node) => node.id === value);
  const normalizedQuery = query.trim().toLowerCase();
  const filteredNodes = useMemo(() => {
    if (!normalizedQuery) return nodes;
    return nodes.filter((node) => {
      const haystack = `${node.name} ${node.driver} ${node.id}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [nodes, normalizedQuery]);

  return (
    <div className={compact ? "space-y-2" : "w-full max-w-xl space-y-2"}>
      <div className="flex items-center justify-between gap-3 text-xs text-[var(--text-secondary)]">
        <span>
          {t("filesBrowserSpa.currentSelectionLabel")}{getNodeIcon(selectedNode?.driver ?? "")}{" "}
          {getNodeLabel(t, selectedNode)}
        </span>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-cyan-300 hover:text-cyan-100 light:hover:text-cyan-700 light:hover:text-cyan-900"
          >
            {t("filesBrowserSpa.clear")}
          </button>
        ) : null}
      </div>
      <div className="space-y-1">
        <label htmlFor={searchInputId} className="block text-xs font-medium text-[var(--text-secondary)]">
          {t("filesBrowserSpa.searchStorageNode")}
        </label>
        <input
          id={searchInputId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder={t("filesBrowserSpa.searchPlaceholder")}
          className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
        />
      </div>
      <div className="space-y-1">
        <label htmlFor={selectInputId} className="block text-xs font-medium text-[var(--text-secondary)]">
          {t("filesBrowserSpa.selectStorageNode")}
        </label>
        <select
          id={selectInputId}
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="w-full rounded-2xl border border-cyan-400/30 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none light:border-cyan-500/40"
        >
          <option value="">{t("filesBrowserSpa.allNodesOption")}</option>
          {filteredNodes.map((node) => (
            <option key={node.id} value={node.id}>
              {getNodeIcon(node.driver)} {node.name}（{node.driver}）
            </option>
          ))}
        </select>
      </div>
      {filteredNodes.length === 0 ? (
        <p className="text-xs text-amber-300">
          {t("filesBrowserSpa.noMatchingNode")}
        </p>
      ) : null}
    </div>
  );
}

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

/* ── FolderTree (client-side, SPA) ──────────────────────────────── */

function FolderTreeClient({
  t,
  node,
  currentPath,
  onNavigate,
  expandedPaths,
  onToggle,
  depth = 0,
}: {
  t: (k: string) => string;
  node: TreeRootNode;
  currentPath: string;
  onNavigate: (path: string) => void;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  depth?: number;
}) {
  const children = node.children;
  if (!children || children.length === 0) return null;

  return (
    <ul
      className={
        depth === 0
          ? "mt-3 space-y-1"
          : "mt-1 space-y-1 border-l border-white/10 pl-3"
      }
    >
      {children.map((child) => {
        const isCurrent = child.path === currentPath;
        const hasChildren = Boolean(child.children?.length);
        const isExpanded = expandedPaths.has(child.path);

        return (
          <li key={child.path || child.name}>
            <div
              className={`flex items-center gap-1 rounded-2xl transition ${
                isCurrent
                  ? "bg-cyan-400/10 text-cyan-100"
                  : "text-slate-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  hasChildren ? onToggle(child.path) : onNavigate(child.path)
                }
                aria-label={
                  hasChildren
                    ? `${isExpanded ? t("filesBrowserSpa.collapseNode") : t("filesBrowserSpa.expandNode")} ${child.displayName ?? child.name}`
                    : t("filesBrowserSpa.openChild").replace("{name}", child.displayName ?? child.name)
                }
                aria-expanded={hasChildren ? isExpanded : undefined}
                className="grid h-8 w-8 flex-none place-items-center rounded-xl text-xs text-[var(--text-secondary)] hover:bg-white/10 hover:text-white light:hover:text-slate-900"
              >
                {hasChildren ? (isExpanded ? "▾" : "▸") : "•"}
              </button>
              <button
                type="button"
                onClick={() => onNavigate(child.path)}
                aria-current={isCurrent ? "page" : undefined}
                aria-label={child.name}
                className="flex min-w-0 flex-1 items-center justify-between px-2 py-2 text-left text-sm"
              >
                <span className="truncate">
                  📁 {child.displayName ?? child.name}
                </span>
                <span
                  aria-hidden="true"
                  className="ml-3 flex-none text-xs text-slate-500"
                >
                  {child.fileCount + child.folderCount}
                </span>
              </button>
            </div>
            {hasChildren && isExpanded ? (
              <FolderTreeClient
                t={t}
                node={child}
                currentPath={currentPath}
                onNavigate={onNavigate}
                expandedPaths={expandedPaths}
                onToggle={onToggle}
                depth={depth + 1}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/* ── Breadcrumbs (client-side, SPA) ─────────────────────────────── */

function BreadcrumbsClient({
  t,
  path,
  nodes,
  onNavigate,
}: {
  t: (k: string) => string;
  path: string;
  nodes: NodeOption[];
  onNavigate: (path: string) => void;
}) {
  const segments = splitPath(path);

  return (
    <nav
      aria-label={t("filesBrowserSpa.breadcrumbAria")}
      className="flex flex-wrap items-center gap-2 text-sm text-[var(--text-secondary)]"
    >
      <button
        type="button"
        onClick={() => onNavigate("")}
        className="rounded-full border border-[var(--border)] px-3 py-1.5 text-slate-200 hover:bg-white/5"
      >
        {t("filesBrowserSpa.allFiles")}
      </button>
      {segments.map((segment, index) => {
        const nextPath = segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        const displaySegment = getDisplaySegment(segment, nodes);
        return (
          <span key={nextPath} className="flex items-center gap-2">
            <span>/</span>
            {isLast ? (
              <span data-tone="cyan" className="rounded-full border border-cyan-400/30 px-3 py-1.5 text-cyan-100">
                {displaySegment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(nextPath)}
                className="rounded-full border border-[var(--border)] px-3 py-1.5 text-slate-200 hover:bg-white/5"
              >
                {displaySegment}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
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
    <section className="mt-8 grid gap-8 xl:grid-cols-[320px_minmax(0,1fr)]">
      {/* Mobile-only sidebar toggle (hidden on xl+) */}
      <button
        type="button"
        onClick={() => setMobileSidebarOpen((value) => !value)}
        aria-expanded={mobileSidebarOpen}
        aria-controls="files-browser-sidebar"
        className="flex min-h-11 w-full items-center justify-between rounded-2xl border border-[var(--border)] bg-slate-900/60 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800/60 light:bg-slate-100 light:hover:bg-slate-200/60 xl:hidden"
      >
        <span>{mobileSidebarOpen ? t("filesBrowserSpa.collapseDirectoryTree") : t("filesBrowserSpa.expandDirectoryTree")}</span>
        <span aria-hidden="true" className="text-xs">
          {mobileSidebarOpen ? "▴" : "▾"}
        </span>
      </button>
      {/* Sidebar: Directory tree */}
      <aside
        id="files-browser-sidebar"
        aria-label={t("filesBrowserSpa.sidebarAria")}
        className={`min-w-[280px] rounded-3xl border border-[var(--border)] bg-slate-900/60 p-6 ${
          mobileSidebarOpen ? "block" : "hidden xl:block"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-white">{t("filesBrowserSpa.directoryTree")}</h2>
            <p className="mt-2 text-sm leading-7 text-[var(--text-secondary)]">
              {t("filesBrowserSpa.hierarchyDescription")}
            </p>
          </div>
        </div>

        {/* Node filter in sidebar - compact for sidebar */}
        {data.nodes.length > 1 ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <label className="text-xs text-[var(--text-secondary)]">
              {t("filesBrowserSpa.filterByNode")}
            </label>
            <NodeFilterSelect
              t={t}
              nodes={data.nodes}
              value={data.nodeIdFilter}
              onChange={handleNodeFilterChange}
              compact
            />
          </div>
        ) : null}

        <div className="mt-5 max-h-[28rem] overflow-x-auto overflow-y-auto rounded-2xl border border-[var(--border)] bg-slate-950/50 p-4 pr-2">
          <button
            type="button"
            onClick={() => handleTreeNavigate("")}
            className={`flex min-h-11 w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm ${
              data.currentPath === ""
                ? "bg-cyan-400/10 text-cyan-100"
                : "text-cyan-100 hover:bg-white/5"
            }`}
          >
            <span>{t("filesBrowserSpa.allFiles")}</span>
            <span className="text-xs text-cyan-200/70">
              {data.stats.totalEntries}
            </span>
          </button>
          {data.tree.children && data.tree.children.length > 0 ? (
            <FolderTreeClient
              t={t}
              node={data.tree}
              currentPath={data.currentPath}
              onNavigate={handleTreeNavigate}
              expandedPaths={expandedTreePaths}
              onToggle={toggleTreePath}
            />
          ) : null}
        </div>
      </aside>

      {/* Main content area */}
      <section className="space-y-8">
        {/* VPS Node Selector - searchable */}
        {data.nodes.length > 1 ? (
          <article data-tone="cyan" className="rounded-3xl border border-cyan-400/20 p-5 light:border-cyan-500/20 light:bg-cyan-50">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  {t("filesBrowserSpa.switchStorageNode")}
                </h3>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {t("filesBrowserSpa.switchStorageNodeDesc")}
                </p>
              </div>
              <NodeFilterSelect
                t={t}
                nodes={data.nodes}
                value={data.nodeIdFilter}
                onChange={handleNodeFilterChange}
              />
            </div>
          </article>
        ) : null}

        {/* Search + Toolbar */}
        <article className="rounded-3xl border border-[var(--border)] bg-slate-900/60 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">
                {currentPathDisplay.title}
                {loading ? (
                  <span className="ml-2 text-sm text-cyan-300 animate-pulse">
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
                    className="rounded-2xl border border-[var(--border)] bg-slate-950 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  data-tone="cyan" className="rounded-full border border-cyan-400/30 px-5 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
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
                    className="rounded-full border border-[var(--border)] bg-white/5 px-5 py-2.5 text-sm font-medium text-[var(--text-secondary)] transition hover:bg-white/10"
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

          <div data-tone="cyan" className="mt-6 rounded-3xl border border-cyan-400/20 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="text-xl font-semibold text-white">
                  {t("filesBrowserSpa.currentDirectoryOps")}
                </h3>
                <p className="mt-2 text-sm text-[var(--text-secondary)]">
                  {t("filesBrowserSpa.currentPathPrefix")}{currentPathDisplay.label}
                </p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {t("filesBrowserSpa.itemCountWithSource")
                    .replace("{count}", String(data.stats.totalItems))
                    .replace("{sources}", data.sourceSummary.join("、"))}
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
                  data-tone="emerald" className="rounded-full border border-emerald-400/30 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? t("filesBrowserSpa.refreshing") : `↻ ${refreshLabel}`}
                </button>
                {data.permissions.canEditLocalFiles ? (
                  <a
                    href="#upload-section"
                    data-tone="accent"
                    className="rounded-full border px-4 py-2 text-sm font-medium transition"
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
                    className="cursor-not-allowed rounded-full border border-[var(--border)] bg-white/5 px-4 py-2 text-sm font-medium text-[var(--text-secondary)]"
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
              data-tone="amber" className="mt-4 rounded-lg border border-amber-400/30 px-4 py-3 text-sm text-amber-100"
            >
              {data.syncWarning === listError
                ? t("filesBrowserSpa.remoteSyncNotice")
                : t("filesBrowserSpa.fileListRefreshFailed")}
              ：{listError}
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
