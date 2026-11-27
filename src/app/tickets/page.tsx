import { firstSearchParam } from "@/lib/http/first-search-param";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { countTickets } from "@/lib/ticket/service";
import { parseTicketFilters } from "@/lib/ticket/filters";
import { listTicketBoard, listTicketPage } from "@/lib/ticket/query";
import { PageShell, StatCard, StatGrid } from "@/components/page-shell";
import { TicketsPageClient } from "./tickets-page-client";
import { toWorkspaceBoard, toWorkspaceTicket } from "@/lib/ticket/workspace-dto";
import { listServerProfiles } from "@/lib/server/service-profiles";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

function param(value: string | string[] | undefined): string {
  return firstSearchParam(value)?.trim() ?? "";
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requirePagePermission("ticket:read", { redirectTo: "/tickets" });
  const canManage = sessionHasPermission(session, "ticket:manage");
  const canCreate = sessionHasPermission(session, "ticket:create");
  const canReadCommands = sessionHasPermission(session, "command:read");
  const locale = await getServerLocale();
  const canUseServerPicker = canCreate && sessionHasPermission(session, "server:read");
  const servers = canUseServerPicker ? await listServerProfiles(session) : [];
  const listInput = { userId: session.userId, includeAll: canManage, session };
  // The first view the URL asks for, filtered and paged in the database like
  // every later one the workspace fetches.
  const params = await searchParams;
  const query = parseTicketFilters((key) => param(params[key]));
  const now = new Date();
  const board = param(params.view) === "board";
  const [counts, firstPage, firstBoard] = await Promise.all([
    countTickets(listInput),
    board ? null : listTicketPage({ ...listInput, query, page: Number.parseInt(param(params.page) || "1", 10) || 1, now }),
    board ? listTicketBoard({ ...listInput, query, now }) : null,
  ]);
  const { open: openCount, inProgress: progressCount, resolved: resolvedCount, urgent: urgentCount } = counts;

  return (
    <PageShell>
      <TicketsPageClient
        header={{ eyebrow: t("ticketsPage.eyebrow", locale), title: t("ticketsPage.title", locale), description: t("ticketsPage.desc", locale) }}
        canCreate={canCreate}
        canManage={canManage}
        canReadCommands={canReadCommands}
        servers={servers.map((server: { id: string; name: string; host: string }) => ({ id: server.id, name: server.name, host: server.host }))}
        stats={
          <StatGrid cols={4}>
            <StatCard label={t("ticketsPage.status.OPEN", locale)} value={String(openCount)} accent={openCount > 0} accentColor="cyan" />
            <StatCard label={t("ticketsPage.status.IN_PROGRESS", locale)} value={String(progressCount)} accent={progressCount > 0} accentColor="amber" />
            <StatCard label={t("ticketsPage.status.RESOLVED", locale)} value={String(resolvedCount)} accent={resolvedCount > 0} accentColor="emerald" />
            <StatCard label={t("ticketsPage.stats.highOrUrgent", locale)} value={String(urgentCount)} accent={urgentCount > 0} accentColor="rose" />
          </StatGrid>
        }
        workspace={{
          initialPage: firstPage ? { tickets: firstPage.tickets.map(toWorkspaceTicket), total: firstPage.total, page: firstPage.page } : null,
          initialBoard: firstBoard ? toWorkspaceBoard(firstBoard) : null,
          canManage,
          now: now.toISOString(),
        }}
      />
    </PageShell>
  );
}
