"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
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

function buildFilesPageUrl({
  path,
  q,
  scope,
  nodeId,
}: {
  path: string;
  q?: string;
  scope?: string;
  nodeId?: string;
}) {
  const params = new URLSearchParams();
  if (path) params.set("path", path);
  if (q) params.set("q", q);
  if (scope && scope !== "current") params.set("scope", scope);
  if (nodeId) params.set("nodeId", nodeId);
  const qs = params.toString();
  return qs ? `/files?${qs}` : "/files";
}

function getFilesStateFromLocation(defaultNodeId: string) {
  const params = new URLSearchParams(window.location.search);
  return {
    path: params.get("path") ?? "",
    q: params.get("q") ?? "",
    scope: params.get("scope") === "all" ? "all" : "current",
    nodeId: params.get("nodeId") ?? defaultNodeId,
  };
}

function getCurrentPathDisplay(path: string, nodes: NodeOption[], nodeIdFilter: string) {
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
        : "全部节点";
  return {
    title: selectedNode?.name ?? groupNode?.name ?? (remotePath || "全部文件"),
    label: `${nodeLabel}：/${remotePath}`,
    uploadPathLabel: `/${remotePath}`,
  };
}

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
            className="text-cyan-300 hover:text-cyan-100 light:hover:text-cyan-700 light:hover:text-cyan-900"
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
                className="grid h-8 w-8 flex-none place-items-center rounded-xl text-xs text-slate-400 light:text-slate-600 hover:bg-white/10 hover:text-white light:hover:text-slate-900"
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
  nodes,
  onNavigate,
}: {
  path: string;
  nodes: NodeOption[];
  onNavigate: (path: string) => void;
}) {
  const segments = splitPath(path);

  return (
    <nav
      aria-label="面包屑"
      className="flex flex-wrap items-center gap-2 text-sm text-slate-400 light:text-slate-600"
    >
      <button
        type="button"
        onClick={() => onNavigate("")}
        className="rounded-full border border-white/10 light:border-slate-200 px-3 py-1.5 text-slate-200 light:text-slate-800 hover:bg-white/5"
      >
        全部文件
      </button>
      {segments.map((segment, index) => {
        const nextPath = segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;
        const displaySegment = getDisplaySegment(segment, nodes);
        return (
          <span key={nextPath} className="flex items-center gap-2">
            <span>/</span>
            {isLast ? (
              <span className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-cyan-100 light:text-cyan-900">
                {displaySegment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(nextPath)}
                className="rounded-full border border-white/10 light:border-slate-200 px-3 py-1.5 text-slate-200 light:text-slate-800 hover:bg-white/5"
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
  const [selectionEpoch, setSelectionEpoch] = useState(0);
  const [searchInput, setSearchInput] = useState(initialData.searchQuery);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch files for a given path — SPA navigation, no page reload
  const fetchFiles = useCallback(
    async (
      path: string,
      q?: string,
      scope?: string,
      nodeId?: string,
      options?: FetchFilesOptions,
    ) => {
      // Cancel previous request
      if (abortRef.current) {
        abortRef.current.abort();
      }
      const controller = new AbortController();
      abortRef.current = controller;
      const shouldResetSelection = options?.resetSelection ?? false;
      const historyMode = options?.history ?? "replace";

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
        if (shouldResetSelection) {
          setSelectionEpoch((current) => current + 1);
        }
        if (nextData.syncWarning) {
          setListError(nextData.syncWarning);
        }

        const newUrl = buildFilesPageUrl({
          path,
          q,
          scope,
          nodeId: effectiveNodeId,
        });
        if (historyMode === "push") {
          window.history.pushState(null, "", newUrl);
        } else if (historyMode === "replace") {
          window.history.replaceState(null, "", newUrl);
        }
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

  useEffect(() => {
    const handlePopState = () => {
      const next = getFilesStateFromLocation(initialData.nodeIdFilter);
      setSearchInput(next.q);
      void fetchFiles(next.path, next.q, next.scope, next.nodeId, {
        resetSelection: true,
        history: "none",
      });
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [fetchFiles, initialData.nodeIdFilter]);

  const { navigateToFolder } = useFolderNavigation(fetchFiles);

  // Search handler
  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      fetchFiles(
        data.currentPath,
        searchInput,
        data.searchScope,
        data.nodeIdFilter,
        { resetSelection: true },
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
        { resetSelection: true },
      );
    },
    [fetchFiles, data.currentPath, data.searchQuery, data.nodeIdFilter],
  );

  const uploadNodes = data.nodes.filter(
    (n) => n.driver === "LOCAL" || n.driver === "SFTP",
  );
  const currentPathDisplay = getCurrentPathDisplay(
    data.currentPath,
    data.nodes,
    data.nodeIdFilter,
  );
  const selectedNode = getNodeById(data.nodes, data.nodeIdFilter);
  const preferredUploadNode = data.nodeIdFilter && uploadNodes.some((node) => node.id === data.nodeIdFilter)
    ? data.nodeIdFilter
    : uploadNodes[0]?.id ?? data.nodes[0]?.id;
  const refreshLabel = selectedNode?.driver === "SFTP" ? "刷新远端文件" : "刷新列表";
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

  return (
    <section className="mt-8 grid gap-8 xl:grid-cols-[280px_minmax(0,1fr)]">
      {/* Sidebar: Directory tree */}
      <aside className="rounded-3xl border border-white/10 light:border-slate-200 bg-slate-900/60 light:bg-white/60 p-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold text-white light:text-slate-900">目录树</h2>
            <p className="mt-2 text-sm leading-7 text-slate-300 light:text-slate-700">
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

        <div className="mt-5 max-h-[28rem] overflow-y-auto rounded-2xl border border-white/10 light:border-slate-200 bg-slate-950/50 light:bg-white/50 p-4 pr-2">
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
            <span className="text-xs text-cyan-200/70 light:text-cyan-800/70">
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
                  节点变多后可以先搜索，再从下拉框切换到目标节点；列表会自动按 LOCAL 或 SFTP 节点类型执行浏览、上传、下载和文件操作。
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
        <article className="rounded-3xl border border-white/10 light:border-slate-200 bg-slate-900/60 light:bg-white/60 p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-white light:text-slate-900">
                {currentPathDisplay.title}
                {loading ? (
                  <span className="ml-2 text-sm text-cyan-300 light:text-cyan-700 animate-pulse">
                    加载中…
                  </span>
                ) : null}
              </h2>
              <p className="mt-2 text-sm leading-7 text-slate-300 light:text-slate-700">
                {currentPathDisplay.label ? `当前路径：${currentPathDisplay.label}` : "当前路径：全部节点：/"}
              </p>
            </div>
            <BreadcrumbsClient
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
                  <label htmlFor="files-search-query" className="text-xs font-medium text-slate-400 light:text-slate-600">
                    搜索文件名
                  </label>
                  <input
                    id="files-search-query"
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.currentTarget.value)}
                    placeholder={
                      data.searchScope === "all"
                        ? "在全部文件中搜索…"
                        : "在当前目录搜索…"
                    }
                    className="rounded-2xl border border-white/10 light:border-slate-200 bg-slate-950 light:bg-white px-4 py-2.5 text-sm text-white light:text-slate-900 placeholder:text-slate-500 light:placeholder:text-slate-400 focus:border-cyan-400/50 focus:outline-none"
                  />
                </div>
                <button
                  type="submit"
                  className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-5 py-2.5 text-sm font-medium text-cyan-100 light:text-cyan-900 transition hover:bg-cyan-400/20"
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
                    className="rounded-full border border-white/10 light:border-slate-200 bg-white/5 px-5 py-2.5 text-sm font-medium text-slate-300 light:text-slate-700 transition hover:bg-white/10"
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </div>
            {data.searchQuery ? (
              <p className="mt-2 text-xs text-slate-400 light:text-slate-600">
                搜索 &quot;{data.searchQuery}&quot; —{" "}
                {data.searchScope === "all" ? "在全部文件中" : "在当前目录"}找到{" "}
                {data.stats.totalItems} 个结果
              </p>
            ) : null}
          </form>

          <div className="mt-6 rounded-3xl border border-cyan-400/20 bg-cyan-400/5 p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <h3 className="text-xl font-semibold text-white light:text-slate-900">
                  当前目录操作
                </h3>
                <p className="mt-2 text-sm text-slate-300 light:text-slate-700">
                  当前路径：{currentPathDisplay.label}
                </p>
                <p className="mt-1 text-sm text-slate-300 light:text-slate-700">
                  项目数 {data.stats.totalItems}
                  {data.sourceSummary.length > 0
                    ? ` · 来源节点：${data.sourceSummary.join("、")}`
                    : ""}
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
                  className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-100 light:text-emerald-900 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "刷新中…" : `↻ ${refreshLabel}`}
                </button>
                {data.permissions.canEditLocalFiles ? (
                  <a
                    href="#upload-section"
                    className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-medium text-cyan-100 light:text-cyan-900 transition hover:bg-cyan-400/20"
                  >
                    ⬆ 上传文件
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
                        ? "没有文件编辑权限，无法新建文件夹"
                        : "当前没有可用的存储节点，无法新建文件夹"
                    }
                    className="cursor-not-allowed rounded-full border border-white/10 light:border-slate-200 bg-white/5 px-4 py-2 text-sm font-medium text-slate-400 light:text-slate-600"
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

        {/* Upload section */}
        {data.permissions.canEditLocalFiles ? (
          <div id="upload-section">
            <FileUploadDropzone
              nodes={data.nodes}
              initialNodeId={preferredUploadNode}
              initialRelativeDir={data.currentPath}
              uploadDir={data.currentPath}
              title={`上传到当前目录 ${currentPathDisplay.uploadPathLabel}`}
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
