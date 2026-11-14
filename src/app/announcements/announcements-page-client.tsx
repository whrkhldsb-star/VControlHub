"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps } from "react";

import { ActionButton } from "@/components/action-button";
import { Plus } from "@/components/icons";
import { PageHeader, SurfacePanel } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

import { AnnouncementList } from "./announcement-list-client";
import { CreateAnnouncementForm } from "./create-announcement-form";

type Props = {
  header: { eyebrow?: string; title: string; description?: string };
  canManage: boolean;
  items: ComponentProps<typeof AnnouncementList>["items"];
  now: number;
};

/**
 * The announcements page. "Post announcement" sits in the header and opens the form right under it; otherwise the
 * announcements come first, as everyone else reads them. An empty list offers the same command to administrators.
 */
export function AnnouncementsPageClient({ header, canManage, items, now }: Props) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setCreating(false), []);
  const open = canManage && !creating ? () => setCreating(true) : undefined;

  useEffect(() => {
    if (creating) panelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [creating]);

  return (
    <>
      <PageHeader eyebrow={header.eyebrow} title={header.title} description={header.description} className="mb-6">
        {open ? (
          <ActionButton icon={<Plus size={16} aria-hidden />} onClick={open}>
            {t("announcementsPage.create.title")}
          </ActionButton>
        ) : null}
      </PageHeader>
      {creating ? (
        <div ref={panelRef} className="mb-6 scroll-mt-24">
          <SurfacePanel title={t("announcementsPage.create.title")}>
            <CreateAnnouncementForm onClose={close} />
          </SurfacePanel>
        </div>
      ) : null}
      {/* Keyed by what the server listed: a refresh after a change starts the list from it. */}
      <AnnouncementList key={items.map((item) => item.id).join("|")} items={items} canManage={canManage} now={now} onCreate={open} />
    </>
  );
}
