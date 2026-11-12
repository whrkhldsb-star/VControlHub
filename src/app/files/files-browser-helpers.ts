import { getStorageNodeGroupKey } from "@/lib/files/tree";

import type { FileProp } from "./file-entry-utils";
import type { FolderProp } from "./file-list-model";

/* ── Types ──────────────────────────────────────────────────────── */

export type TreeNode = {
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

export type TreeRootNode = {
  name: string;
  path: string;
  fileCount?: number;
  folderCount?: number;
  sourceKeys?: string[];
  sourceValues?: string[];
  children: TreeNode[] | null;
};

export type FilesApiResponse = {
  /** Absent only on legacy embedded listings. */
  pagination?: {page:number;pageSize:number;totalItems:number;totalPages:number};
  sort?: "name" | "size" | "source" | "updated";
  direction?: "asc" | "desc";
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
  nodes: { id: string; name: string; driver: string; basePath?: string; isDefault?: boolean; healthStatus?: string | null; teamName?: string | null; fileCount?: number }[];
};

/* ── Helpers ────────────────────────────────────────────────────── */

export function splitPath(path: string) {
  return path ? path.split("/").filter(Boolean) : [];
}

/** Parent virtual path for SPA browser; empty string is root, null means already root. */
export function getParentPath(path: string): string | null {
  const segments = splitPath(path);
  if (segments.length === 0) return null;
  return segments.slice(0, -1).join("/");
}

export function treePathMatchesCurrentPath(treePath: string, currentPath: string) {
  const normalizedTreePath = treePath.replace(/^\/+|\/+$/g, "");
  const normalizedCurrentPath = currentPath.replace(/^\/+|\/+$/g, "");
  if (!normalizedCurrentPath) return false;
  // Exact match only — endsWith(`/current`) falsely expands unrelated branches
  // when a segment is a path suffix (e.g. tree `archive/docs` vs current `docs`).
  return normalizedTreePath === normalizedCurrentPath;
}

export function getInitialExpandedTreePaths(tree: TreeRootNode, currentPath: string) {
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

export type NodeOption = { id: string; name: string; driver: string; basePath?: string };

export function getNodeById(nodes: NodeOption[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId);
}

/**
 * The node a path of the "all locations" view starts in. Only there, and only in its first segment, does a path
 * name a node — by the node's group key, `<name>__<start of its id>` (getStorageNodeGroupKey). Everything after
 * it is folders, whose names may hold "__" themselves (`__pycache__`, `my__notes`), and so may the node's name:
 * splitting every segment at "__" emptied such folders' names and lost such nodes.
 */
export function getPathGroupNode<N extends { id: string; name: string }>(nodes: N[], path: string, nodeIdFilter: string): N | null {
  if (nodeIdFilter) return null;
  const first = splitPath(path)[0];
  if (!first) return null;
  const exact = nodes.find((node) => getStorageNodeGroupKey(node) === first);
  if (exact) return exact;
  // A key written before the node was renamed still ends with the start of its id. Two nodes created in the same
  // instant share that start, and then nothing but the whole key tells them apart.
  const at = first.lastIndexOf("__");
  const idStart = at > 0 ? first.slice(at + 2) : "";
  const sameStart = idStart ? nodes.filter((node) => node.id.slice(0, 8) === idStart) : [];
  return sameStart.length === 1 ? sameStart[0]! : null;
}

export function getCurrentPathDisplay(t: (k: string, vars?: Record<string, string | number>) => string, path: string, nodes: NodeOption[], nodeIdFilter: string) {
  const segments = splitPath(path);
  const groupNode = getPathGroupNode(nodes, path, nodeIdFilter);
  const node = getNodeById(nodes, nodeIdFilter) ?? groupNode;
  const remotePath = (groupNode ? segments.slice(1) : segments).join("/");
  return {
    title: node?.name ?? (remotePath || t("filesBrowserSpa.allFiles")),
    label: `${getNodeLabel(t, node ?? undefined)}: /${remotePath}`,
    uploadPathLabel: `/${remotePath}`,
  };
}

export function getNodeLabel(t: (k: string, vars?: Record<string, string | number>) => string, node?: NodeOption) {
  if (!node) return t("filesBrowserSpa.allNodes");
  return `${node.name} (${node.driver})`;
}

/**
 * Where a new folder or upload goes from the current view (A4-31). Inside a
 * node the answer is the node and the path; in the "all locations" view a
 * drilled-into path like `Node__ab12/docs` names the node by its group
 * segment, and the remainder is the directory on it. Without either, the
 * caller asks the user for a node and starts at its root.
 */
export function resolveBrowserLocation(nodes: NodeOption[], path: string, nodeIdFilter: string): { nodeId: string; relativePath: string } {
  if (nodeIdFilter) return { nodeId: nodeIdFilter, relativePath: path };
  const node = getPathGroupNode(nodes, path, nodeIdFilter);
  if (!node) return { nodeId: "", relativePath: "" };
  return { nodeId: node.id, relativePath: splitPath(path).slice(1).join("/") };
}
