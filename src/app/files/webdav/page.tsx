import { requireSession } from "@/lib/auth/require-session";
import { getStorageOverview } from "@/lib/storage/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { PageShell, PageHeader, SurfacePanel } from "@/components/page-shell";
import { WebDavSetupPanel } from "@/components/storage/webdav-setup-panel";
import { FilesSubpageNav } from "../files-subpage-nav";

export const dynamic = "force-dynamic";

export default async function FilesWebDavPage() {
  const session = await requireSession("/files/webdav");
  const locale = await getServerLocale();
  const storage = await getStorageOverview(session);

  return (
    <PageShell maxW="max-w-5xl">
      <PageHeader
        eyebrow={t("filesPage.eyebrow", locale)}
        title={t("filesPage.subPage.webdav", locale)}
        description={t("filesPage.subPage.webdavDesc", locale)}
      />
      <FilesSubpageNav />
      <SurfacePanel
        title={t("filesPage.webdav.title", locale)}
        description={t("filesPage.webdav.description", locale)}
      >
        <WebDavSetupPanel
          nodes={storage.nodes
            .filter((n) => n.driver === "LOCAL" || n.driver === "SFTP")
            .map((n) => ({ id: n.id, name: n.name, driver: n.driver }))}
        />
      </SurfacePanel>
    </PageShell>
  );
}
