import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getStorageFormOptions } from "@/app/storage/actions";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { PageShell, PageHeader, SurfacePanel } from "@/components/page-shell";
import { BidirectionalSyncPanel } from "@/components/storage/bidirectional-sync-panel";
import { FilesSubpageNav } from "../files-subpage-nav";

export const dynamic = "force-dynamic";

export default async function FilesSyncPage() {
  const session = await requireSession("/files/sync");
  const locale = await getServerLocale();
  const canManage = sessionHasPermission(session, "storage:write")
    || sessionHasPermission(session, "storage:manage-node");
  const formOptions = canManage
    ? await getStorageFormOptions()
    : { servers: [], nodes: [] };

  return (
    <PageShell maxW="max-w-5xl">
      <PageHeader
        eyebrow={t("filesPage.eyebrow", locale)}
        title={t("filesPage.subPage.sync", locale)}
        description={t("filesPage.subPage.syncDesc", locale)}
      />
      <FilesSubpageNav />
      <SurfacePanel
        title={t("filesPage.syncJobs.title", locale)}
        description={t("filesPage.syncJobs.desc", locale)}
      >
        <BidirectionalSyncPanel
          servers={formOptions.servers.map((s: { id: string; name: string; host?: string | null }) => ({
            id: s.id,
            name: s.name,
            host: s.host ?? null,
          }))}
        />
      </SurfacePanel>
    </PageShell>
  );
}
