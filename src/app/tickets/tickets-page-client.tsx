"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";

import { ActionButton } from "@/components/action-button";
import { Plus } from "@/components/icons";
import { PageHeader, SurfacePanel } from "@/components/page-shell";
import { useI18n } from "@/lib/i18n/use-locale";

import { CreateTicketForm } from "./create-ticket-form";
import { TicketWorkspace } from "./ticket-workspace";

type Props = {
  header: { eyebrow?: string; title: string; description?: string };
  canCreate: boolean;
  servers: { id: string; name: string; host: string }[];
  /** The figures under the header, rendered by the server. */
  stats: ReactNode;
  workspace: Omit<ComponentProps<typeof TicketWorkspace>, "onCreate">;
};

/**
 * The tickets page around its figures. "New ticket" sits in the header and opens the form right under it; the list
 * comes first otherwise, as on the other pages that create things. An empty list offers the same command.
 */
export function TicketsPageClient({ header, canCreate, servers, stats, workspace }: Props) {
  const { t } = useI18n();
  const [creating, setCreating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setCreating(false), []);
  const open = canCreate && !creating ? () => setCreating(true) : undefined;

  // Opened from the empty list further down too: bring the form into view.
  useEffect(() => {
    if (creating) panelRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, [creating]);

  return (
    <>
      <PageHeader eyebrow={header.eyebrow} title={header.title} description={header.description} className="mb-6">
        {open ? (
          <ActionButton icon={<Plus size={16} aria-hidden />} onClick={open}>
            {t("ticketsPage.form.title")}
          </ActionButton>
        ) : null}
      </PageHeader>
      {creating ? (
        <div ref={panelRef} className="mb-6 scroll-mt-24">
          <SurfacePanel title={t("ticketsPage.form.title")}>
            <CreateTicketForm servers={servers} onClose={close} />
          </SurfacePanel>
        </div>
      ) : null}
      {stats}
      <TicketWorkspace {...workspace} onCreate={open} />
    </>
  );
}
