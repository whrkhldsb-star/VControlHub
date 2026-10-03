"use client";

import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/use-locale";
import { TabNav } from "@/components/ui-primitives";

const ITEMS = [
  { href: "/files", exact: true, labelKey: "filesPage.subNav.browser" },
  { href: "/files/search", exact: false, labelKey: "filesPage.subNav.search" },
  { href: "/files/recycle-bin", exact: false, labelKey: "filesPage.subNav.recycleBin" },
  { href: "/files/webdav", exact: false, labelKey: "filesPage.subNav.webdav" },
  { href: "/files/sync", exact: false, labelKey: "filesPage.subNav.sync" },
  { href: "/files/recent-downloads", exact: false, labelKey: "filesPage.subNav.recentDownloads" },
] as const;

/** Secondary nav strip shared by all /files/* subpages. */
export function FilesSubpageNav() {
  const { t } = useI18n();
  const pathname = usePathname();

  return (
    <TabNav
      ariaLabel={t("filesPage.subNav.aria")}
      className="mb-5"
      items={ITEMS.map((item) => ({
        href: item.href,
        label: t(item.labelKey),
        active: item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`),
      }))}
    />
  );
}
