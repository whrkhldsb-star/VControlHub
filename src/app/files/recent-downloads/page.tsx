"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n/use-locale";
import { PageShell, PageHeader } from "@/components/page-shell";
import { RecentDownloadsPanel } from "../recent-downloads-panel";
import { FilesSubpageNav } from "../files-subpage-nav";

export default function FilesRecentDownloadsPage() {
  const { t } = useI18n();
  const router = useRouter();

  return (
    <PageShell maxW="max-w-5xl">
      <PageHeader
        eyebrow={t("filesPage.eyebrow")}
        title={t("filesPage.subPage.recentDownloads")}
        description={t("filesPage.subPage.recentDownloadsDesc")}
      />
      <FilesSubpageNav />
      <RecentDownloadsPanel
        onNavigate={(path, nodeId) => {
          const params = new URLSearchParams();
          if (path) params.set("path", path);
          if (nodeId) params.set("nodeId", nodeId);
          const qs = params.toString();
          router.push(qs ? `/files?${qs}` : "/files");
        }}
      />
    </PageShell>
  );
}
