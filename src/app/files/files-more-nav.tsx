"use client";

import { useI18n } from "@/lib/i18n/use-locale";
import { Menu, MenuItem } from "@/components/ui/menu";

const LINKS = [
  { href: "/files/search", titleKey: "filesPage.subPage.search", descKey: "filesPage.subPage.searchDesc" },
  { href: "/files/recycle-bin", titleKey: "filesPage.subPage.recycleBin", descKey: "filesPage.subPage.recycleBinDesc" },
  { href: "/files/webdav", titleKey: "filesPage.subPage.webdav", descKey: "filesPage.subPage.webdavDesc" },
  { href: "/files/sync", titleKey: "filesPage.subPage.sync", descKey: "filesPage.subPage.syncDesc" },
  { href: "/files/recent-downloads", titleKey: "filesPage.subPage.recentDownloads", descKey: "filesPage.subPage.recentDownloadsDesc" },
] as const;

/**
 * Compact “更多功能” dropdown for the files browser shell.
 * Keeps the main /files page as a cloud-drive style browser and
 * routes advanced tools (WebDAV / sync / search / recycle / downloads)
 * into dedicated subpages.
 */
export function FilesMoreNav() {
  const { t } = useI18n();
  return (
    <Menu
      label={t("filesPage.moreFeaturesAria")}
      trigger={t("filesPage.moreFeatures")}
      align="end"
      panelClassName="w-80"
    >
      {LINKS.map((link) => (
        <MenuItem key={link.href} href={link.href} description={t(link.descKey)}>
          {t(link.titleKey)}
        </MenuItem>
      ))}
    </Menu>
  );
}
