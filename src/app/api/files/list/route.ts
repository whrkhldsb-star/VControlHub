import { NextRequest, NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { withApiRoute } from "@/lib/http/api-guard";
import {
  getStorageAccessCapabilities,
  getStorageAccessCapabilityKey,
} from "@/lib/storage/access-control";
import { getStorageOverview } from "@/lib/storage/service";
import {
  getSftpSyncNode,
  syncSftpDirectoryEntries,
} from "@/lib/storage/sftp-sync";
import {
  buildFileTree,
  findFileTreeNode,
  isDirectoryEntry,
  normalizeFilePath,
  resolveStorageNodeGroupedPath,
  searchFileTree,
  serializeFileTreeFolder,
  serializeFileTreeNode,
} from "@/lib/files/tree";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "获取文件列表失败" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      const canEditLocalFiles = sessionHasPermission(session, "storage:write");
      const canDelete = sessionHasPermission(session, "storage:delete");
      const canShare = sessionHasPermission(session, "share:create");
      const canManageNodes = sessionHasPermission(
        session,
        "storage:manage-node",
      );

      const searchParams = request.nextUrl.searchParams;
      const currentPath = normalizeFilePath(
        searchParams.get("path") ?? undefined,
      );
      const searchQuery = (searchParams.get("q") ?? "").trim();
      const searchScope =
        searchParams.get("scope") === "all" ? "all" : "current";
      const nodeIdFilter = searchParams.get("nodeId") ?? "";
      let syncWarning: string | null = null;

      let storage = await getStorageOverview();

      const groupedPath = resolveStorageNodeGroupedPath(currentPath, storage.nodes);
      const effectiveNodeId = nodeIdFilter || groupedPath?.node.id || "";
      const effectiveSyncPath = nodeIdFilter ? currentPath : groupedPath?.remotePath ?? currentPath;

      if (effectiveNodeId) {
        const selectedNode = storage.nodes.find(
          (node) => node.id === effectiveNodeId,
        );
        if (selectedNode?.driver === "SFTP") {
          const syncNode = await getSftpSyncNode(effectiveNodeId);
          if (syncNode?.driver === "SFTP") {
            const syncResult = await syncSftpDirectoryEntries({
              node: syncNode,
              remotePath: effectiveSyncPath,
              recursive: false,
              maxDepth: 1,
            });
            if (syncResult.errors.length > 0) {
              syncWarning =
                syncResult.errors[0] ?? "远端目录同步失败，已显示本地索引";
            } else {
              storage = await getStorageOverview();
            }
          }
        }
      }

      // Filter entries by explicit nodeId or grouped node path if specified
      const filteredEntries = effectiveNodeId
        ? storage.entries.filter((e) => e.storageNode.id === effectiveNodeId)
        : storage.entries;
      const filteredDirectories = effectiveNodeId
        ? storage.remoteDirectories.filter(
            (d) => d.storageNodeId === effectiveNodeId,
          )
        : storage.remoteDirectories;

      // When no specific node/path group is selected, group entries by node to avoid
      // mixing SFTP root directories with LOCAL directories at root level
      const groupByNode = !effectiveNodeId;
      const tree = buildFileTree(
        filteredEntries,
        filteredDirectories,
        groupByNode,
        storage.nodes,
      );
      const responseCurrentPath = effectiveNodeId ? effectiveSyncPath : currentPath;
      const responseNodeIdFilter = effectiveNodeId;
      const currentNode = findFileTreeNode(tree, responseCurrentPath) ?? tree;

      let folders = [...currentNode.folders.values()].sort((a, b) =>
        a.name.localeCompare(b.name, "zh-CN"),
      );
      let files = [...currentNode.files]
        .filter((entry) => !isDirectoryEntry(entry))
        .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));

      // Apply search filter
      if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase();
        if (searchScope === "all") {
          const allResults = searchFileTree(tree, searchQuery);
          folders = allResults.folders;
          files = allResults.files;
        } else {
          folders = folders.filter((f) =>
            f.name.toLowerCase().includes(lowerQuery),
          );
          files = files.filter((e) =>
            e.name.toLowerCase().includes(lowerQuery),
          );
        }
      }

      const sourceSummary = [...currentNode.sources.values()];
      const totalItems = folders.length + files.length;
      const capabilityMap = await getStorageAccessCapabilities({
        session,
        targets: [
          ...folders
            .filter((folder) => folder.storageNodeId && folder.relativePath)
            .map((folder) => ({
              storageNodeId: folder.storageNodeId!,
              relativePath: folder.relativePath!,
            })),
          ...files.map((entry) => ({
            storageNodeId: entry.storageNode.id,
            relativePath: entry.relativePath,
          })),
        ],
      });

      return NextResponse.json({
        currentPath: responseCurrentPath,
        nodeIdFilter: responseNodeIdFilter,
        folders: folders.map((folder) => {
          const serialized = serializeFileTreeFolder(folder);
          const capabilityKey = serialized.storageNodeId
            ? getStorageAccessCapabilityKey({
                storageNodeId: serialized.storageNodeId,
                relativePath: serialized.relativePath,
              })
            : null;
          return {
            ...serialized,
            capabilities: capabilityKey ? capabilityMap.get(capabilityKey) ?? null : null,
          };
        }),
        files: files.map((entry) => ({
          id: entry.id,
          name: entry.name,
          entryType: entry.entryType,
          mimeType: entry.mimeType ?? null,
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
          capabilities:
            capabilityMap.get(
              getStorageAccessCapabilityKey({
                storageNodeId: entry.storageNode.id,
                relativePath: entry.relativePath,
              }) ?? "",
            ) ?? null,
          updatedAt:
            "updatedAt" in entry && entry.updatedAt
              ? String(entry.updatedAt)
              : null,
        })),
        tree: {
          name: tree.name,
          path: tree.path,
          children: serializeFileTreeNode(tree),
        },
        stats: {
          ...storage.stats,
          totalItems,
        },
        sourceSummary,
        searchQuery,
        searchScope,
        syncWarning,
        permissions: {
          canEditLocalFiles,
          canDelete,
          canShare,
          canManageNodes,
        },
        nodes: storage.nodes.map((n) => ({
          id: n.id,
          name: n.name,
          driver: n.driver,
        })),
      });
    },
  );
}
