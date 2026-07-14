import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { listTickets } from "@/lib/ticket/service";
import { PageShell, PageHeader, StatCard } from "@/components/page-shell";
import { CreateTicketForm } from "./create-ticket-form";
import { TicketWorkspace, type TicketWorkspaceTicket } from "./ticket-workspace";
import { listServerProfiles } from "@/lib/server/service-profiles";
import { getServerLocale, t, type Locale } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

function priorityLabel(locale: Locale, key: string): string {
  const translated = t(`ticketsPage.priority.${key}`, locale);
  return translated !== `ticketsPage.priority.${key}` ? translated : key;
}

export default async function Page() {
  const session = await requireSession("/tickets");
  const canManage = sessionHasPermission(session, "ticket:manage");
  const canCreate = sessionHasPermission(session, "ticket:create");
  const locale = await getServerLocale();
  const servers = await listServerProfiles();
  const tickets = await listTickets({
    userId: session.userId,
    includeAll: canManage,
    session,
  });

  const openCount = tickets.filter((ticket) => ticket.status === "OPEN").length;
  const progressCount = tickets.filter((ticket) => ticket.status === "IN_PROGRESS").length;
  const resolvedCount = tickets.filter((ticket) => ticket.status === "RESOLVED" || ticket.status === "CLOSED").length;
  const urgentCount = tickets.filter((ticket) => ticket.priority === "URGENT" || ticket.priority === "HIGH").length;
  const initialTickets: TicketWorkspaceTicket[] = tickets.map((ticket) => ({
    id: ticket.id,
    title: ticket.title,
    description: ticket.description,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    slaDueAt: ticket.slaDueAt?.toISOString() ?? null,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    creator: ticket.creator,
    assignee: ticket.assignee,
  }));

  return (
    <PageShell maxW="max-w-7xl">
      <PageHeader eyebrow={t("ticketsPage.eyebrow", locale)} title={t("ticketsPage.title", locale)} description={t("ticketsPage.desc", locale)} className="mb-6" />

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t("ticketsPage.status.OPEN", locale)} value={String(openCount)} accent={openCount > 0} accentColor="cyan" />
        <StatCard label={t("ticketsPage.status.IN_PROGRESS", locale)} value={String(progressCount)} accent={progressCount > 0} accentColor="amber" />
        <StatCard label={t("ticketsPage.status.RESOLVED", locale)} value={String(resolvedCount)} accent={resolvedCount > 0} accentColor="emerald" />
        <StatCard label={priorityLabel(locale, "HIGH")} value={String(urgentCount)} accent={urgentCount > 0} accentColor="rose" />
      </section>

      {canCreate && (
        <div className="mb-6">
          <CreateTicketForm locale={locale} servers={servers.map((server: { id: string; name: string; host: string }) => ({ id: server.id, name: server.name, host: server.host }))} />
        </div>
      )}

      <TicketWorkspace initialTickets={initialTickets} canManage={canManage} locale={locale} now={new Date().toISOString()} />
    </PageShell>
  );
}
