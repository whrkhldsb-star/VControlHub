import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getStorageFormOptions } from "@/app/storage/actions";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { PageShell, PageHeader, SurfacePanel } from "@/components/page-shell";
import { BidirectionalSyncPanel } from "@/components/storage/bidirectional-sync-panel";
import { PageGuide } from "@/components/page-guide";
import { FilesSubpageNav } from "../files-subpage-nav";

export const dynamic = "force-dynamic";

export default async function FilesSyncPage() {
  const session = await requirePagePermission("storage:read", { redirectTo: "/files/sync" });
  const locale = await getServerLocale();
  const canManage = sessionHasPermission(session, "storage:write");
  const formOptions = canManage
    ? await getStorageFormOptions()
    : { servers: [], nodes: [] };

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("filesPage.eyebrow", locale)}
        title={t("filesPage.subPage.sync", locale)}
        description={t("filesPage.subPage.syncDesc", locale)}
      />
      <FilesSubpageNav />
      <PageGuide title={t("filesPage.syncJobs.guide", locale)} steps={[t("filesPage.syncJobs.desc", locale), t("filesPage.syncJobs.guideStep2", locale)]} />
      <SurfacePanel>
        <BidirectionalSyncPanel
          canManage={canManage}
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
