import { apiCopy } from "@/lib/i18n/api-copy";
import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { listStorageNodes } from "@/lib/storage/service-nodes";
import { listFileEntries } from "@/lib/storage/service-entries";
import { getFileIndexStatistics } from "@/lib/storage/service-statistics";
import {
  getStorageAccessCapabilities,
  getStorageAccessCapabilityKey,
} from "@/lib/storage/access-control";
import {
  getLocalSyncNode,
  syncLocalDirectoryEntries,
} from "@/lib/storage/local-sync";
import {
  getSftpSyncNode,
  syncSftpDirectoryEntries,
} from "@/lib/storage/sftp-sync";
import {
  getWebDavSyncNode,
  syncWebDavDirectoryEntries,
} from "@/lib/storage/webdav-sync";
import {
  getStorageNodeGroupKey,
  normalizeFilePath,
  resolveStorageNodeGroupedPath,
} from "./tree";
import type { SerializedTreeFolderDto, SerializedTreeNodeDto } from "./dto";
import type { ListFilesQuery } from "./schema";
import {
  queryFileListing,
  queryFolderCounts,
  type FileListingRow,
} from "./listing-query";

async function synchronizeDirectory(
  node: { id: string; driver: string },
  path: string,
  session: SessionPayload,
) {
  if (node.driver === "LOCAL") {
    const syncNode = await getLocalSyncNode(node.id, session);
    if (syncNode)
      return (
        (
          await syncLocalDirectoryEntries({
            node: syncNode,
            relativePath: path,
          })
        ).errors[0] ?? null
      );
  } else if (node.driver === "SFTP") {
    const syncNode = await getSftpSyncNode(node.id, session);
    if (syncNode)
      return (
        (
          await syncSftpDirectoryEntries({
            node: syncNode,
            remotePath: path,
            recursive: false,
            maxDepth: 1,
          })
        ).errors[0] ?? null
      );
  } else if (node.driver === "WEBDAV") {
    const syncNode = await getWebDavSyncNode(node.id, session);
    if (syncNode)
      return (
        (
          await syncWebDavDirectoryEntries({
            node: syncNode,
            relativePath: path,
          })
        ).errors[0] ?? null
      );
  }
  return null;
}

/** SSR and the refresh API must share normalization, synchronization and serialization. */
export async function getFilesListing(
  session: SessionPayload,
  query: ListFilesQuery,
) {
  const nodes = await listStorageNodes(session);
  const rawPath = normalizeFilePath(query.path);
  const grouped = resolveStorageNodeGroupedPath(rawPath, nodes);
  const nodeId = query.nodeId || grouped?.node.id || "";
  const currentPath = query.nodeId ? rawPath : (grouped?.remotePath ?? rawPath);
  const segments = currentPath.split("/");
  if (
    segments.some(
      (part) => part === "." || part === ".." || part.includes("\0"),
    ) ||
    segments.length > 128
  ) {
    throw new ValidationError(apiCopy("apiCopy.invalid.directory.path.d0f37ed0"));
  }
  const selectedNode = nodeId
    ? nodes.find((node) => node.id === nodeId)
    : undefined;
  if (nodeId && !selectedNode)
    throw new NotFoundError(apiCopy("apiCopy.storage.node.not.found.3b3ec488"));
  if (!nodeId && currentPath) throw new NotFoundError(apiCopy("apiCopy.directory.not.found.33df1f77"));
  const syncWarning =
    selectedNode && query.sync === "1"
      ? await synchronizeDirectory(selectedNode, currentPath, session)
      : null;
  const scopedNodes = selectedNode ? [selectedNode] : nodes;
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const searchQuery = query.q ?? "";
  const recursive = query.scope === "all" && Boolean(searchQuery);
  const [indexStats, page] = await Promise.all([
    getFileIndexStatistics(nodes.map((node) => node.id)),
    !selectedNode && !recursive
      ? Promise.resolve(null)
      : queryFileListing({
          nodeIds: scopedNodes.map((node) => node.id),
          path: currentPath,
          query: searchQuery,
          recursive,
          page: query.page,
          pageSize: query.pageSize,
          sort: query.sort,
          direction: query.direction,
        }),
  ]);
  let rows: FileListingRow[];
  let total: number;
  let currentPage: number;
  if (page) {
    rows = page.rows;
    total = page.total;
    currentPage = page.page;
  } else {
    const matchingNodes = nodes
      .filter((node) =>
        node.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) *
            (query.direction === "desc" ? -1 : 1) || a.id.localeCompare(b.id),
      );
    total = matchingNodes.length;
    currentPage = Math.min(
      query.page,
      Math.max(1, Math.ceil(total / query.pageSize)),
    );
    rows = matchingNodes
      .slice((currentPage - 1) * query.pageSize, currentPage * query.pageSize)
      .map((node) => ({
        storageNodeId: node.id,
        relativePath: "",
        name: node.name,
        entryId: null,
        directory: true,
      }));
  }
  const folderRows = rows.filter((row) => row.directory);
  const ancestorFolders =
    selectedNode && currentPath
      ? currentPath.split("/").map((_, index, parts) => ({
          storageNodeId: nodeId,
          relativePath: parts.slice(0, index + 1).join("/"),
        }))
      : [];
  const fileIds = rows
    .filter((row) => !row.directory && row.entryId)
    .map((row) => row.entryId!);
  const [folderCounts, entries, capabilities] = await Promise.all([
    queryFolderCounts([...folderRows, ...ancestorFolders]),
    fileIds.length
      ? listFileEntries(
          undefined,
          { ids: fileIds, take: query.pageSize },
          session,
        )
      : Promise.resolve([]),
    getStorageAccessCapabilities({
      session,
      targets: rows.map((row) => ({
        storageNodeId: row.storageNodeId,
        relativePath: row.relativePath,
      })),
    }),
  ]);
  const virtualPath = (row: { storageNodeId: string; relativePath: string }) =>
    selectedNode
      ? row.relativePath
      : [
          getStorageNodeGroupKey(nodeMap.get(row.storageNodeId)!),
          row.relativePath,
        ]
          .filter(Boolean)
          .join("/");
  const folders = folderRows.map((row) => {
    const node = nodeMap.get(row.storageNodeId)!;
    return {
      name: row.relativePath ? row.name : getStorageNodeGroupKey(node),
      displayName: row.relativePath
        ? row.name
        : `${node.name} (${node.driver})`,
      path: virtualPath(row),
      entryId: row.entryId,
      storageNodeId: row.relativePath ? node.id : null,
      relativePath: row.relativePath || null,
      ...(folderCounts.get(`${node.id}:${row.relativePath}`) ?? {
        fileCount: 0,
        folderCount: 0,
      }),
      sourceKeys: [node.id],
      sourceValues: [`${node.name} (${node.driver})`],
      capabilities: row.relativePath
        ? (capabilities.get(getStorageAccessCapabilityKey(row) ?? "") ?? null)
        : null,
    };
  });
  const entryMap = new Map(entries.map((entry) => [entry.id, entry]));
  const files = fileIds.flatMap((id) => {
    const entry = entryMap.get(id);
    if (!entry) return [];
    return [
      {
        id: entry.id,
        name: entry.name,
        entryType: entry.entryType,
        mimeType: entry.mimeType,
        relativePath: entry.relativePath,
        sizeBytes: entry.size == null ? null : Number(entry.size),
        sizeLabel: entry.sizeLabel,
        previewable: entry.previewable,
        localEditable: entry.localEditable,
        directAccessMode: entry.directAccess.mode,
        directAccessHref: entry.directAccess.href ?? null,
        directAccessFallbackHref:
          "fallbackHref" in entry.directAccess
            ? entry.directAccess.fallbackHref
            : null,
        directAccessDescription: entry.directAccess.description,
        storageNodeId: entry.storageNode.id,
        storageNodeName: entry.storageNode.name,
        storageNodeDriver: entry.storageNode.driver,
        storageNodeServerId: entry.storageNode.serverId ?? null,
        capabilities:
          capabilities.get(
            getStorageAccessCapabilityKey({
              storageNodeId: entry.storageNodeId,
              relativePath: entry.relativePath,
            }) ?? "",
          ) ?? null,
        updatedAt: entry.updatedAt ? String(entry.updatedAt) : null,
      },
    ];
  });
  // Only the visible branch is serialized. Opening a child requests its own
  // listing; unrelated descendants never inflate every refresh response.
  const treeChildren = folders.map((folder) => ({ ...folder, children: [] }));
  let branch: SerializedTreeNodeDto[] = treeChildren;
  if (selectedNode && currentPath) {
    const parts = currentPath.split("/");
    for (let index = parts.length - 1; index >= 0; index--) {
      const folder: SerializedTreeFolderDto = {
        name: parts[index]!,
        path: parts.slice(0, index + 1).join("/"),
        entryId: null,
        storageNodeId: nodeId,
        relativePath: parts.slice(0, index + 1).join("/"),
        ...(folderCounts.get(
          `${nodeId}:${parts.slice(0, index + 1).join("/")}`,
        ) ?? { fileCount: 0, folderCount: 0 }),
        sourceKeys: [nodeId],
        sourceValues: [`${selectedNode.name} (${selectedNode.driver})`],
      };
      branch = [{ ...folder, children: branch }];
    }
  }
  return {
    nodes,
    listing: {
      currentPath,
      nodeIdFilter: nodeId,
      folders,
      files,
      tree: { name: "All files", path: "", children: branch },
      stats: {
        ...indexStats,
        totalNodes: nodes.length,
        defaultNodeName:
          nodes.find((node) => node.isDefault)?.name ?? "Not configured",
        localNodeCount: nodes.filter((node) => node.driver === "LOCAL").length,
        sftpNodeCount: nodes.filter((node) => node.driver === "SFTP").length,
        totalItems: total,
      },
      pagination: {
        page: currentPage,
        pageSize: query.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
      sort: query.sort,
      direction: query.direction,
      sourceSummary: scopedNodes.map((node) => `${node.name} (${node.driver})`),
      searchQuery,
      searchScope: query.scope,
      syncWarning,
      permissions: {
        canEditLocalFiles: sessionHasPermission(session, "storage:write"),
        canDelete: sessionHasPermission(session, "storage:delete"),
        canShare: sessionHasPermission(session, "share:create"),
        canManageNodes: sessionHasPermission(session, "storage:manage-node"),
      },
      nodes: nodes.map((node) => ({
        id: node.id,
        name: node.name,
        driver: node.driver,
        basePath: node.driver === "LOCAL" ? node.basePath : undefined,
      })),
    },
  };
}
