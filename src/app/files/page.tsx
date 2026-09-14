import Link from "next/link";
import { createHash } from "node:crypto";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getFilesListing } from "@/lib/files/listing-service";
import { listFilesQuerySchema } from "@/lib/files/schema";
import { getStorageFormOptions } from "@/app/storage/actions";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { FilesBrowserSpa } from "./files-browser-spa";
import { PageShell, PageHeader } from "@/components/page-shell";
import { StorageNodeManager } from "./storage-node-manager";
import { FilesMoreNav } from "./files-more-nav";

export const dynamic = "force-dynamic";

type FilesPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function FilesPage({ searchParams }: FilesPageProps) {
  const session = await requirePagePermission("storage:read", {
    redirectTo: "/files",
  });
  const locale = await getServerLocale();
  const canManageNodes = sessionHasPermission(session, "storage:manage-node");
  const canEditLocalFiles = sessionHasPermission(session, "storage:write");
  const query = listFilesQuerySchema.parse((await searchParams) ?? {});
  const [{ listing: initialData, nodes }, formOptions] = await Promise.all([
    getFilesListing(session, query),
    canManageNodes || canEditLocalFiles
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
        sort: initialData.sort,
        direction: initialData.direction,
        folders: initialData.folders.map((folder) => folder.relativePath),
        files: initialData.files.map((file) => [
          file.id,
          file.relativePath,
          file.updatedAt,
        ]),
      }),
    )
    .digest("base64url");

  return (
    <PageShell maxW="max-w-7xl">
      <PageHeader
        eyebrow={t("filesPage.eyebrow", locale)}
        title={t("filesPage.title", locale)}
        description={t("filesPage.description", locale)}
      >
        <FilesMoreNav />
        <Link
          href="/audit"
          data-action-button
          data-variant="secondary"
          className="!px-3 !text-sm"
        >
          {t("filesPage.linkAuditLog", locale)}
        </Link>
        <Link
          href="/health"
          data-action-button
          data-variant="secondary"
          className="!px-3 !text-sm"
        >
          {t("filesPage.linkHealthCheck", locale)}
        </Link>
        <Link
          href="/servers"
          data-action-button
          data-variant="secondary"
          className="!px-3 !text-sm"
        >
          {t("filesPage.linkServers", locale)}
        </Link>
      </PageHeader>
      <FilesBrowserSpa key={browserSnapshotKey} initialData={initialData}>
        <StorageNodeManager
          nodes={nodes}
          servers={formOptions.servers}
          canManageNodes={canManageNodes}
        />
      </FilesBrowserSpa>
    </PageShell>
  );
}
