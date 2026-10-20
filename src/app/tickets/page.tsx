import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { countTickets } from "@/lib/ticket/service";
import { listTicketBoard, listTicketPage, type TicketSlaFilter } from "@/lib/ticket/query";
import { PageShell, PageHeader, StatCard, StatGrid } from "@/components/page-shell";
import { CreateTicketForm } from "./create-ticket-form";
import { TicketWorkspace } from "./ticket-workspace";
import { toWorkspaceBoard, toWorkspaceTicket } from "@/lib/ticket/workspace-dto";
import { listServerProfiles } from "@/lib/server/service-profiles";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

function priorityLabel(locale: Locale, key: string): string {
  const translated = t(`ticketsPage.priority.${key}`, locale);
  return translated !== `ticketsPage.priority.${key}` ? translated : key;
}

const SLA_FILTERS = new Set(["ok", "warning", "breached", "none"]);

function param(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await requireSession("/tickets");
  const canManage = sessionHasPermission(session, "ticket:manage");
  const canCreate = sessionHasPermission(session, "ticket:create");
  const locale = await getServerLocale();
  const canUseServerPicker = canCreate && sessionHasPermission(session, "server:read");
  const servers = canUseServerPicker ? await listServerProfiles(session) : [];
  const listInput = { userId: session.userId, includeAll: canManage, session };
  // The first view the URL asks for, filtered and paged in the database like
  // every later one the workspace fetches.
  const params = await searchParams;
  const sla = param(params.sla);
  const query = {
    status: param(params.status) || undefined,
    priority: param(params.priority) || undefined,
    category: param(params.category) || undefined,
    slaStatus: SLA_FILTERS.has(sla) ? (sla as TicketSlaFilter) : undefined,
    search: param(params.q) || undefined,
  };
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
      <PageHeader eyebrow={t("ticketsPage.eyebrow", locale)} title={t("ticketsPage.title", locale)} description={t("ticketsPage.desc", locale)} className="mb-6" />

      <StatGrid cols={4}>
        <StatCard label={t("ticketsPage.status.OPEN", locale)} value={String(openCount)} accent={openCount > 0} accentColor="cyan" />
        <StatCard label={t("ticketsPage.status.IN_PROGRESS", locale)} value={String(progressCount)} accent={progressCount > 0} accentColor="amber" />
        <StatCard label={t("ticketsPage.status.RESOLVED", locale)} value={String(resolvedCount)} accent={resolvedCount > 0} accentColor="emerald" />
        <StatCard label={priorityLabel(locale, "HIGH")} value={String(urgentCount)} accent={urgentCount > 0} accentColor="rose" />
      </StatGrid>

      {canCreate && (
        <div className="mb-6">
          <CreateTicketForm locale={locale} servers={servers.map((server: { id: string; name: string; host: string }) => ({ id: server.id, name: server.name, host: server.host }))} />
        </div>
      )}

      <TicketWorkspace
        initialPage={firstPage ? { tickets: firstPage.tickets.map(toWorkspaceTicket), total: firstPage.total, page: firstPage.page } : null}
        initialBoard={firstBoard ? toWorkspaceBoard(firstBoard) : null}
        canManage={canManage}
        now={now.toISOString()}
      />
    </PageShell>
  );
}
