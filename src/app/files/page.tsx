import { createHash } from "node:crypto";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getFilesListing } from "@/lib/files/listing-service";
import { readListFilesAddress } from "@/lib/files/schema";
import { getStorageFormOptions } from "@/app/storage/actions";
import { scheduleStorageNodeHealthProbe } from "@/lib/storage/health";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { FilesBrowserSpa } from "./files-browser-spa";
import { PageShell, PageHeader } from "@/components/page-shell";
import { StorageNodeManager } from "./storage-node-manager";
import { FilesSubpageNav } from "./files-subpage-nav";

export const dynamic = "force-dynamic";

/**
 * What a reader may see of a storage node. The node dialog sent everyone who can read files the node's host,
 * port, account, root path and WebDAV address, while `/api/storage/nodes` already gave them a trimmed list:
 * they get the name, type, health and file count; the connection stays with whoever manages nodes.
 */
function withoutConnectionDetails(node: Awaited<ReturnType<typeof getFilesListing>>["nodes"][number], description: string) {
  return {
    id: node.id, name: node.name, driver: node.driver, teamName: node.teamName, isDefault: node.isDefault,
    fileCount: node.fileCount, healthStatus: node.healthStatus, lastHealthCheckAt: node.lastHealthCheckAt,
    lastHealthLatencyMs: node.lastHealthLatencyMs, basePath: "", connectionSummary: "", connectionHidden: true,
    directAccess: { mode: node.directAccess.mode, description, href: null },
  };
}

type FilesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FilesPage({ searchParams }: FilesPageProps) {
  const session = await requirePagePermission("storage:read", {
    redirectTo: "/files",
  });
  const locale = await getServerLocale();
  const canManageNodes = sessionHasPermission(session, "storage:manage-node");
  const query = readListFilesAddress((await searchParams) ?? {});
  // The node cards show each node's health. Its only automatic refresh was
  // the signed-in /status page: production nodes still read "checked
  // 10-04" weeks later, so a node that went down kept showing healthy.
  // Fire-and-forget; only nodes not checked in five minutes are probed.
  scheduleStorageNodeHealthProbe();
  const [{ listing: initialData, nodes }, formOptions] = await Promise.all([
    getFilesListing(session, query),
    canManageNodes
      ? getStorageFormOptions()
      : Promise.resolve({ servers: [], nodes: [] }),
  ]);
  const browserSnapshotKey = createHash("sha256")
    .update(
      JSON.stringify({
        nodeId: initialData.nodeIdFilter,
        path: initialData.currentPath,
        page: initialData.pagination.page,
        query: initialData.searchQuery,
        scope: initialData.searchScope,
        team: session.currentTeamId,
        user: session.userId,
        pageSize: initialData.pagination.pageSize,
      }),
    )
    .digest("base64url");

  const manageDrives = (
    <StorageNodeManager
      nodes={canManageNodes ? nodes : nodes.map(node => withoutConnectionDetails(node, t("filesPage.managedDrive", locale)))}
      servers={formOptions.servers}
      canManageNodes={canManageNodes}
    />
  );
  return (
    <PageShell>
      <PageHeader
        eyebrow={t("filesPage.eyebrow", locale)}
        title={t("filesPage.title", locale)}
        description={t("filesPage.description", locale)}
      >
        {manageDrives}
      </PageHeader>
      <FilesSubpageNav recycleBinCount={initialData.stats.deletedEntries} />
      <FilesBrowserSpa key={browserSnapshotKey} initialData={initialData} manageDrives={manageDrives} />
    </PageShell>
  );
}
