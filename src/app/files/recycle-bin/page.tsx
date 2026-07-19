import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getStorageOverview } from "@/lib/storage/service";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { PageShell, PageHeader } from "@/components/page-shell";
import { RecycleBinSectionClient } from "../recycle-bin-section-client";
import { FilesSubpageNav } from "../files-subpage-nav";

export const dynamic = "force-dynamic";

export default async function FilesRecycleBinPage() {
  const session = await requireSession("/files/recycle-bin");
  const locale = await getServerLocale();
  const canDelete = sessionHasPermission(session, "storage:delete");
  const storage = await getStorageOverview(session);

  return (
    <PageShell maxW="max-w-5xl">
      <PageHeader
        eyebrow={t("filesPage.eyebrow", locale)}
        title={t("filesPage.subPage.recycleBin", locale)}
        description={t("filesPage.subPage.recycleBinDesc", locale)}
      />
      <FilesSubpageNav />
      <RecycleBinSectionClient
        deletedEntries={storage.deletedEntries.map((d) => ({
          id: d.id,
          name: d.name,
          entryType: d.entryType,
          relativePath: d.relativePath,
          size: d.size,
        }))}
        canDelete={canDelete}
      />
    </PageShell>
  );
}
