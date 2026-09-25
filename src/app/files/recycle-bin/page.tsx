import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getRecycleBinPage, recycleBinQuerySchema } from "@/lib/files/recycle-bin";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { PageShell, PageHeader } from "@/components/page-shell";
import { RecycleBinSectionClient } from "../recycle-bin-section-client";
import { FilesSubpageNav } from "../files-subpage-nav";

export const dynamic = "force-dynamic";

export default async function FilesRecycleBinPage({ searchParams }: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requirePagePermission("storage:read", { redirectTo: "/files/recycle-bin" });
  const locale = await getServerLocale();
  const canDelete = sessionHasPermission(session, "storage:delete");
  const { entries, pagination } = await getRecycleBinPage(session, recycleBinQuerySchema.parse((await searchParams) ?? {}));

  return (
    <PageShell>
      <PageHeader
        eyebrow={t("filesPage.eyebrow", locale)}
        title={t("filesPage.subPage.recycleBin", locale)}
        description={t("filesPage.subPage.recycleBinDesc", locale)}
      />
      <FilesSubpageNav />
      <RecycleBinSectionClient
        key={`${pagination.page}:${pagination.pageSize}:${entries.map((entry) => entry.id).join(",")}`}
        deletedEntries={entries}
        pagination={pagination}
        canDelete={canDelete}
      />
    </PageShell>
  );
}
