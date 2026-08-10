"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { ActionButton } from "@/components/action-button";

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
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <ActionButton variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
       
        className="!px-3 !py-1.5 !text-xs"
      >
        {t("filesPage.moreFeatures")}
        <span aria-hidden className="ml-1.5 text-[10px] opacity-70">
          {open ? "▴" : "▾"}
        </span>
      </ActionButton>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={t("filesPage.moreFeaturesAria")}
          className="fixed left-4 right-4 z-30 mt-2 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-[var(--shadow-lg)] sm:absolute sm:left-auto sm:right-0 sm:w-80"
        >
          <ul className="py-1">
            {LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  role="menuitem"
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="block px-4 py-3 transition hover:bg-[var(--surface-hover)]"
                >
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {t(link.titleKey)}
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)]">
                    {t(link.descKey)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
