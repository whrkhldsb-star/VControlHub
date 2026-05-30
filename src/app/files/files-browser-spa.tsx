"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { logError } from "@/lib/logging";
import { csrfFetch } from "@/lib/auth/csrf-client";

import {
  FileListClient,
  type FolderProp,
  type FileProp,
} from "./file-list-client";
import { SearchScopeToggle } from "./search-scope-toggle";
import { FileUploadDropzone } from "@/components/storage/file-upload-dropzone";
import { CreateFolderForm } from "./create-folder-form";
import { RecycleBinSectionClient } from "./recycle-bin-section-client";

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

function getFolderLabel(path: string) {
  const segments = splitPath(path);
  if (segments.length === 0) return "全部文件";
  const lastSegment = segments[segments.length - 1];
  // If last segment is a node group key (name__id), extract just the name part
  if (lastSegment.includes("__")) {
    return lastSegment.split("__")[0];
  }
  return lastSegment;
}

function getCurrentPathLabel(path: string) {
  if (!path) return "/";
  const segments = splitPath(path);
  return (
    "/" +
    segments.map((s) => (s.includes("__") ? s.split("__")[0] : s)).join("/")
  );
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

function getNodeIcon(driver: string) {
  return driver === "SFTP" ? "🖥" : "💾";
}

function getNodeLabel(node?: NodeOption) {
  if (!node) return "全部节点";
  return `${node.name}（${node.driver}）`;
}

function NodeFilterSelect({
  nodes,
  value,
  onChange,
  compact = false,
}: {
  nodes: NodeOption[];
  value: string;
  onChange: (nodeId: string) => void;
  compact?: boolean;
}) {
  const [query, setQuery] = useState("");
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
      <div className="flex items-center justify-between gap-3 text-xs text-slate-400 light:text-slate-600">
        <span>
          当前：{getNodeIcon(selectedNode?.driver ?? "")}{" "}
          {getNodeLabel(selectedNode)}
        </span>
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-cyan-300 hover:text-cyan-100 light:text-cyan-700 light:hover:text-cyan-900"
          >
            清除
          </button>
        ) : null}
      </div>
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
        placeholder="搜索节点名称、类型或 ID"
        className="w-full rounded-2xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none light:border-slate-200 light:bg-white light:text-slate-900 light:placeholder:text-slate-400"
      />
      <select
        aria-label="选择存储节点"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="w-full rounded-2xl border border-cyan-400/30 bg-slate-950 px-3 py-2 text-sm text-white focus:border-cyan-400/50 focus:outline-none light:border-cyan-500/40 light:bg-white light:text-slate-900"
      >
        <option value="">🌐 全部节点</option>
        {filteredNodes.map((node) => (
          <option key={node.id} value={node.id}>
            {getNodeIcon(node.driver)} {node.name}（{node.driver}）
          </option>
        ))}
      </select>
      {filteredNodes.length === 0 ? (
        <p className="text-xs text-amber-300 light:text-amber-700">
          没有匹配的节点
        </p>
      ) : null}
    </div>
  );
}

/* ── Navigation hook ────────────────────────────────────────────── */

function useFolderNavigation(
  fetchFiles: (path: string, q?: string, scope?: string) => void,
) {
  const navigateToFolder = useCallback(
    (path: string) => {
      fetchFiles(path);
    },
    [fetchFiles],
  );

  return { navigateToFolder };
}

/* ── FolderTree (client-side, SPA) ──────────────────────────────── */

function FolderTreeClient({
  node,
  currentPath,
  onNavigate,
  expandedPaths,
  onToggle,
  depth = 0,
}: {
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
                    ? `${isExpanded ? "折叠" : "展开"} ${child.displayName ?? child.name}`
                    : `打开 ${child.displayName ?? child.name}`
                }
                aria-expanded={hasChildren ? isExpanded : undefined}
                className="grid h-8 w-8 flex-none place-items-center rounded-xl text-xs text-slate-400 hover:bg-white/10 hover:text-white"
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
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const segments = splitPath(path);

  return (
    <nav
      aria-label="面包屑"
      className="flex flex-wrap items-center gap-2 text-sm text-slate-400"
    >
      <button
        type="button"
        onClick={() => onNavigate("")}
        className="rounded-full border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5"
      >
        全部文件
      </button>
      {segments.map((segment, index) => {
        const nextPath = segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        // For node group keys (name__id), show just the name part
        const displaySegment = segment.includes("__")
          ? segment.split("__")[0]
          : segment;
        return (
          <span key={nextPath} className="flex items-center gap-2">
            <span>/</span>
            {isLast ? (
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-cyan-100">
                {displaySegment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(nextPath)}
                className="rounded-full border border-white/10 px-3 py-1.5 text-slate-200 hover:bg-white/5"
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
  const [data, setData] = useState<FilesApiResponse>(initialData);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch files for a given path — SPA navigation, no page reload
  const fetchFiles = useCallback(
    async (path: string, q?: string, scope?: string, nodeId?: string) => {
      // Cancel previous request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      setListError(null);
      try {
        const params = new URLSearchParams();
        if (path) params.set("path", path);
        if (q) params.set("q", q);
        if (scope && scope !== "current") params.set("scope", scope);
        const effectiveNodeId = nodeId ?? data.nodeIdFilter;
        if (effectiveNodeId) params.set("nodeId", effectiveNodeId);

        const url = `/api/files/list${params.toString() ? `?${params.toString()}` : ""}`;
        const json = await csrfFetch(url, { signal: controller.signal });
        const nextData = json as FilesApiResponse;
        setData(nextData);
        if (nextData.syncWarning) {
          setListError(nextData.syncWarning);
        }

        // Update URL without page reload
        const urlParams = new URLSearchParams();
        if (path) urlParams.set("path", path);
        if (q) urlParams.set("q", q);
        if (scope && scope !== "current") urlParams.set("scope", scope);
        if (effectiveNodeId) urlParams.set("nodeId", effectiveNodeId);
        const qs = urlParams.toString();
        const newUrl = qs ? `/files?${qs}` : "/files";
        window.history.replaceState(null, "", newUrl);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        logError("Failed to fetch files:", err);
        setListError(
          err instanceof Error ? err.message : "文件列表刷新失败，请稍后重试。",
        );
      } finally {
        setLoading(false);
      }
    },
    [data.nodeIdFilter],
  );

  const { navigateToFolder } = useFolderNavigation(fetchFiles);

  // Search handler
  const [searchInput, setSearchInput] = useState(data.searchQuery);
  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      fetchFiles(
        data.currentPath,
        searchInput,
        data.searchScope,
        data.nodeIdFilter,
      );
    },
    [
      fetchFiles,
      data.currentPath,
      searchInput,
      data.searchScope,
      data.nodeIdFilter,
    ],
  );

  const handleScopeChange = useCallback(
    (newScope: string) => {
      fetchFiles(
        data.currentPath,
        data.searchQuery,
        newScope,
        data.nodeIdFilter,
      );
    },
    [fetchFiles, data.currentPath, data.searchQuery, data.nodeIdFilter],
  );

  const uploadNodes = data.nodes.filter(
    (n) => n.driver === "LOCAL" || n.driver === "SFTP",
  );
  const currentPathLabel = getCurrentPathLabel(data.currentPath);
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
      fetchFiles("", data.searchQuery, data.searchScope, newNodeId);
    },
    [fetchFiles, data.searchQuery, data.searchScope],
  );

  return (
    <section className="mt-8 grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]">
      {/* Sidebar: Directory tree */}
      <aside className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-white">目录树</h2>
            <p className="mt-2 text-sm leading-7 text-slate-300">
              按层级展开所有已登记目录，便于快速跳转。
            </p>
          </div>
        </div>

        {/* Node filter in sidebar - compact for sidebar */}
        {data.nodes.length > 1 ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <label className="text-xs text-slate-400 light:text-slate-600">
              按节点筛选
            </label>
            <NodeFilterSelect
              nodes={data.nodes}
              value={data.nodeIdFilter}
              onChange={handleNodeFilterChange}
              compact
            />
          </div>
        ) : null}

        <div className="mt-5 max-h-[28rem] overflow-y-auto rounded-2xl border border-white/10 bg-slate-950/50 p-4 pr-2">
          <button
            type="button"
            onClick={() => navigateToFolder("")}
            className={`flex w-full items-center justify-between rounded-2xl px-3 py-2 text-sm text-left ${
              data.currentPath === ""
                ? "bg-cyan-400/10 text-cyan-100"
                : "text-cyan-100 hover:bg-white/5"
            }`}
          >
            <span>全部文件</span>
            <span className="text-xs text-cyan-200/70">
              {data.stats.totalEntries}
            </span>
          </button>
          {data.tree.children && data.tree.children.length > 0 ? (
            <FolderTreeClient
              node={data.tree}
              currentPath={data.currentPath}
              onNavigate={navigateToFolder}
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
          <article className="rounded-3xl border border-cyan-400/20 bg-cyan-400/5 p-5 light:border-cyan-500/20 light:bg-cyan-50">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h3 className="text-lg font-semibold text-white light:text-slate-950">
                  切换存储节点
                </h3>
                <p className="mt-1 text-sm text-slate-400 light:text-slate-600">
                  节点变多后可以先搜索，再从下拉框切换到目标节点。
                </p>
              </div>
              <NodeFilterSelect
                nodes={data.nodes}
                value={data.nodeIdFilter}
                onChange={handleNodeFilterChange}
              />
            </div>
          </article>
        ) : null}

        {/* Search + Toolbar */}
        <article className="rounded-3xl border border-white/10 bg-slate-900/60 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white">
                {getFolderLabel(data.currentPath)}
                {loading ? (
                  <span className="ml-2 text-sm text-cyan-300 animate-pulse">
                    加载中…
                  </span>
                ) : null}
              </h2>
              <p className="mt-2 text-sm leading-7 text-slate-300">
                {data.currentPath
                  ? `当前路径：/${data.currentPath}`
                  : "当前路径：根目录"}
              </p>
            </div>
            <BreadcrumbsClient
              path={data.currentPath}
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
              <div className="flex flex-1 gap-3">
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.currentTarget.value)}
                  placeholder={
                    data.searchScope === "all"
                      ? "搜索全部文件名…"
                      : "搜索当前目录文件名…"
                  }
                  className="flex-1 rounded-2xl border border-white/10 bg-slate-950 px-4 py-2.5 text-sm text-white placeholder:text-slate-500 focus:border-cyan-400/50 focus:outline-none"
                />
                <button
                  type="submit"
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-5 py-2.5 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
                >
                  搜索
                </button>
                {data.searchQuery ? (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchInput("");
                      fetchFiles(data.currentPath);
                    }}
                    className="rounded-full border border-white/10 bg-white/5 px-5 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10"
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </div>
            {data.searchQuery ? (
              <p className="mt-2 text-xs text-slate-400">
                搜索 &quot;{data.searchQuery}&quot; —{" "}
                {data.searchScope === "all" ? "在全部文件中" : "在当前目录"}找到{" "}
                {data.stats.totalItems} 个结果
              </p>
            ) : null}
          </form>

          <div className="mt-6 rounded-3xl border border-cyan-400/20 bg-cyan-400/5 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="text-xl font-semibold text-white">
                  当前目录操作
                </h3>
                <p className="mt-2 text-sm text-slate-300">
                  {data.currentPath
                    ? `当前路径：/${data.currentPath}`
                    : "当前路径：/"}
                </p>
                <p className="mt-1 text-sm text-slate-300">
                  项目数 {data.stats.totalItems}
                  {data.sourceSummary.length > 0
                    ? ` · 来源节点：${data.sourceSummary.join("、")}`
                    : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-3">
                {data.permissions.canEditLocalFiles ? (
                  <a
                    href="#upload-section"
                    className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:bg-cyan-400/20"
                  >
                    ⬆ 上传文件
                  </a>
                ) : null}
                {data.permissions.canEditLocalFiles && data.nodes.length > 0 ? (
                  <CreateFolderForm
                    storageNodes={data.nodes}
                    currentPath={data.currentPath}
                  />
                ) : (
                  <button
                    type="button"
                    disabled
                    aria-disabled="true"
                    className="cursor-not-allowed rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-slate-400"
                  >
                    新建文件夹
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* File list with batch operations */}
          {listError ? (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100 light:text-amber-800"
            >
              {data.syncWarning === listError
                ? "远端同步提醒"
                : "文件列表刷新失败"}
              ：{listError}
            </div>
          ) : null}
          <FileListClient
            folders={data.folders}
            files={data.files}
            canEditLocalFiles={data.permissions.canEditLocalFiles}
            canDelete={data.permissions.canDelete}
            currentPath={data.currentPath}
            searchQuery={data.searchQuery}
            onFolderClick={navigateToFolder}
            onRefresh={() => fetchFiles(data.currentPath)}
          />
        </article>

        {/* Upload section */}
        {data.permissions.canEditLocalFiles ? (
          <div id="upload-section">
            <FileUploadDropzone
              nodes={data.nodes}
              initialNodeId={uploadNodes[0]?.id ?? data.nodes[0]?.id}
              initialRelativeDir={data.currentPath}
              uploadDir={data.currentPath}
              title={`上传到当前目录 ${currentPathLabel}`}
              description="选择目标存储节点和上传目录路径。"
              submitLabel="拖拽文件到这里，或点击选择本地文件"
              pathLabel="上传目录路径"
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

        {/* Recycle bin */}
        <RecycleBinSectionClient
          deletedEntries={deletedEntries}
          canDelete={data.permissions.canDelete}
          onRefresh={() => fetchFiles(data.currentPath)}
        />
      </section>
    </section>
  );
}
