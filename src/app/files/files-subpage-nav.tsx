"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n/use-locale";

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
    <nav
      aria-label={t("filesPage.subNav.aria")}
      className="mb-5 flex flex-wrap gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-2"
    >
      {ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-xl px-3 py-2 text-sm font-medium transition ${
              active
                ? "border border-[var(--color-action-border)] bg-[var(--color-action-bg)] text-[var(--color-action)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)]"
            }`}
          >
            {t(item.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
