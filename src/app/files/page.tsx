import Link from "next/link";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import {
  getStorageAccessCapabilities,
  getStorageAccessCapabilityKey,
} from "@/lib/storage/access-control";
import { getStorageOverview } from "@/lib/storage/service";
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

import { getStorageFormOptions } from "@/app/storage/actions";
import { getSftpSyncNode, syncSftpDirectoryEntries } from "@/lib/storage/sftp-sync";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { FilesBrowserSpa } from "./files-browser-spa";
import { PageShell, PageHeader } from "@/components/page-shell";
import { StorageNodeManager } from "./storage-node-manager";
import { FilesMoreNav } from "./files-more-nav";

export const dynamic = "force-dynamic";

type FilesPageProps = {
  searchParams?: Promise<{
    path?: string;
    q?: string;
    tab?: string;
    scope?: string;
    nodeId?: string;
  }>;
};

export default async function FilesPage({ searchParams }: FilesPageProps) {
  const session = await requireSession("/files");
  const locale = await getServerLocale();
  const canEditLocalFiles = sessionHasPermission(session, "storage:write");
  const canDelete = sessionHasPermission(session, "storage:delete");
  const canShare = sessionHasPermission(session, "share:create");
  const canManageNodes = sessionHasPermission(session, "storage:manage-node");
  const resolvedSearchParams = (await searchParams) ?? {};
  const currentPath = normalizeFilePath(resolvedSearchParams.path);
  const searchQuery = (resolvedSearchParams.q ?? "").trim();
  const searchScope = resolvedSearchParams.scope === "all" ? "all" : "current";
  const nodeIdFilter = resolvedSearchParams.nodeId ?? "";

  const [initialStorage, formOptions] = await Promise.all([
    getStorageOverview(session),
    canManageNodes || canEditLocalFiles
      ? getStorageFormOptions()
      : Promise.resolve({ servers: [], nodes: [] }),
  ]);
  let storage = initialStorage;
  let syncWarning: string | null = null;

  const groupedPath = resolveStorageNodeGroupedPath(currentPath, storage.nodes);
  const effectiveNodeId = nodeIdFilter || groupedPath?.node.id || "";
  const effectiveSyncPath = nodeIdFilter ? currentPath : groupedPath?.remotePath ?? currentPath;

  if (effectiveNodeId) {
    const selectedNode = storage.nodes.find((node) => node.id === effectiveNodeId);
    if (selectedNode?.driver === "SFTP") {
      const syncNode = await getSftpSyncNode(effectiveNodeId, session);
      if (syncNode?.driver === "SFTP") {
        const syncResult = await syncSftpDirectoryEntries({
          node: syncNode,
          remotePath: effectiveSyncPath,
          recursive: false,
          maxDepth: 1,
        });
        if (syncResult.errors.length > 0) {
          syncWarning = syncResult.errors[0] ?? t("filesPage.syncWarningFallback", locale);
        } else {
          storage = await getStorageOverview(session);
        }
      }
    }
  }

  // Filter entries by explicit nodeId or grouped node path if specified
  const filteredEntries = effectiveNodeId
    ? storage.entries.filter((e) => e.storageNode.id === effectiveNodeId)
    : storage.entries;
  const filteredDirectories = effectiveNodeId
    ? storage.remoteDirectories.filter((d) => d.storageNodeId === effectiveNodeId)
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
    a.name.localeCompare(b.name),
  );
  let files = [...currentNode.files]
    .filter((entry) => !isDirectoryEntry(entry))
    .sort((a, b) => a.name.localeCompare(b.name));

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
      files = files.filter((e) => e.name.toLowerCase().includes(lowerQuery));
    }
  }

  const totalItems = folders.length + files.length;
  const sourceSummary = [...currentNode.sources.values()];
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

  // Build initial data for SPA component (same format as API response)
  const initialData = {
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
      directAccessDescription: entry.directAccess.description,
      storageNodeId: entry.storageNode.id,
      storageNodeName: entry.storageNode.name,
      storageNodeDriver: entry.storageNode.driver,
      storageNodeServerId: entry.storageNode.serverId ?? null,
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
    searchScope: searchScope as "current" | "all",
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
  };

  return (
    <PageShell maxW="max-w-7xl">
      <PageHeader
        eyebrow={t("filesPage.eyebrow", locale)}
        title={t("filesPage.title", locale)}
        description={t("filesPage.description", locale)}
      >
        <div className="flex flex-wrap items-center gap-2">
          <FilesMoreNav />
          <Link
            href="/audit"
            data-action-button
            data-variant="secondary"
            className="!px-3 !py-1.5 !text-xs"
          >
            {t("filesPage.linkAuditLog", locale)}
          </Link>
          <Link
            href="/health"
            data-action-button
            data-variant="secondary"
            className="!px-3 !py-1.5 !text-xs"
          >
            {t("filesPage.linkHealthCheck", locale)}
          </Link>
          <Link
            href="/servers"
            data-action-button
            data-variant="secondary"
            className="!px-3 !py-1.5 !text-xs"
          >
            {t("filesPage.linkServers", locale)}
          </Link>
        </div>
      </PageHeader>

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <article data-stat-card data-card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
            {t("filesPage.statTotalNodes", locale)}
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-[var(--text-primary)]">
            {storage.stats.totalNodes}
          </div>
        </article>
        <article data-stat-card data-card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
            {t("filesPage.statActiveFiles", locale)}
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-[var(--text-primary)]">
            {storage.stats.totalEntries}
          </div>
        </article>
        <article data-stat-card data-card className="p-4">
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
            {t("filesPage.statCurrentDirectory", locale)}
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-[var(--text-primary)]">
            {totalItems}
          </div>
        </article>
        <Link
          href="/files/recycle-bin"
          data-stat-card
          data-card
          className="p-4 transition hover:bg-[var(--surface-hover)]"
        >
          <div className="text-xs font-medium uppercase tracking-wider text-[var(--text-secondary)]">
            {t("filesPage.statRecycleBin", locale)}
          </div>
          <div className="mt-1.5 text-2xl font-semibold text-[var(--text-primary)]">
            {storage.stats.deletedEntries}
          </div>
        </Link>
      </section>

      <StorageNodeManager
        nodes={storage.nodes}
        servers={formOptions.servers}
        canManageNodes={canManageNodes}
      />

      <FilesBrowserSpa initialData={initialData} />
    </PageShell>
  );
}
