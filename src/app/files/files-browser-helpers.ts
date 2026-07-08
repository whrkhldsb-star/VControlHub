import {
  type FolderProp,
  type FileProp,
} from "./file-list-client";

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

export type DeletedEntryProp = {
  id: string;
  name: string;
  entryType: string;
  relativePath: string;
  size: number | bigint | null;
};

/* ── Helpers ────────────────────────────────────────────────────── */

export function splitPath(path: string) {
  return path ? path.split("/").filter(Boolean) : [];
}

export function treePathMatchesCurrentPath(treePath: string, currentPath: string) {
  const normalizedTreePath = treePath.replace(/^\/+|\/+$/g, "");
  const normalizedCurrentPath = currentPath.replace(/^\/+|\/+$/g, "");
  if (!normalizedCurrentPath) return false;
  return (
    normalizedTreePath === normalizedCurrentPath ||
    normalizedTreePath.endsWith(`/${normalizedCurrentPath}`)
  );
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

export type NodeOption = { id: string; name: string; driver: string };

export function parseNodeGroupSegment(segment: string) {
  const [label, idPrefix] = segment.split("__");
  return idPrefix ? { label, idPrefix } : null;
}

export function isNodeGroupSegment(segment: string) {
  return parseNodeGroupSegment(segment) !== null;
}

export function getNodeById(nodes: NodeOption[], nodeId: string) {
  return nodes.find((node) => node.id === nodeId);
}

export function getNodeFromGroupSegment(nodes: NodeOption[], segment: string) {
  const group = parseNodeGroupSegment(segment);
  if (!group) return null;
  return nodes.find((node) => node.id.startsWith(group.idPrefix)) ?? null;
}

export function getDisplaySegment(segment: string, nodes: NodeOption[] = []) {
  const group = parseNodeGroupSegment(segment);
  if (!group) return segment;
  const node = getNodeFromGroupSegment(nodes, segment);
  return node ? node.name : group.label;
}

export function getCurrentPathDisplay(t: (k: string) => string, path: string, nodes: NodeOption[], nodeIdFilter: string) {
  const selectedNode = getNodeById(nodes, nodeIdFilter);
  const segments = splitPath(path);
  const groupSegment = segments.find(isNodeGroupSegment);
  const groupNode = groupSegment ? getNodeFromGroupSegment(nodes, groupSegment) : null;
  const remotePathSegments = selectedNode
    ? segments
    : segments.filter((segment) => !isNodeGroupSegment(segment));
  const remotePath = remotePathSegments.map((segment) => getDisplaySegment(segment, nodes)).join("/");
  const nodeLabel = selectedNode
    ? `${selectedNode.name} (${selectedNode.driver})`
    : groupNode
      ? `${groupNode.name} (${groupNode.driver})`
      : groupSegment
        ? getDisplaySegment(groupSegment, nodes)
        : t("filesBrowserSpa.allNodes");
  return {
    title: selectedNode?.name ?? groupNode?.name ?? (remotePath || t("filesBrowserSpa.allFiles")),
    label: `${nodeLabel}: /${remotePath}`,
    uploadPathLabel: `/${remotePath}`,
  };
}

export function getNodeLabel(t: (k: string) => string, node?: NodeOption) {
  if (!node) return t("filesBrowserSpa.allNodes");
  return `${node.name} (${node.driver})`;
}
