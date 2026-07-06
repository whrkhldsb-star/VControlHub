import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { canViewTicket, getTicketById } from "@/lib/ticket/service";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { TicketDetailClient, type Ticket, type TicketUser } from "./ticket-detail-client";
import { notFound } from "next/navigation";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("/tickets");
  const { id } = await params;
  const canManage = sessionHasPermission(session, "ticket:manage");
  const locale = await getServerLocale();
  if (!canManage && !(await canViewTicket(id, session.userId))) {
    return <PageShell><EmptyState text={t("ticketsDetail.permissionDenied", locale)} /></PageShell>;
  }
  const ticket = await getTicketById(id);
  if (!ticket) notFound();

  // Populate the assignee dropdown — previously the <select> rendered
  // with no <option> children, so "Assign to" was visually present but
  // functionally a no-op for every manager.
  const users: TicketUser[] = canManage
    ? await prisma.user.findMany({
        select: { id: true, username: true, displayName: true },
        orderBy: { username: "asc" },
        take: 200,
      })
    : [];

  // Serialize dates for client component
  const serialized: Ticket = {
    ...ticket,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    closedAt: ticket.closedAt?.toISOString() ?? null,
    comments: ticket.comments.map((c) => ({ ...c, createdAt: c.createdAt.toISOString() })),
  };

  return (
    <PageShell maxW="max-w-4xl">
      <PageHeader eyebrow={t("ticketsDetail.eyebrow", locale)} title={t("ticketsDetail.title", locale)} description={t("ticketsDetail.desc", locale)} className="mb-6" />
      <TicketDetailClient initial={serialized} canManage={canManage} users={users} locale={locale} />
    </PageShell>
  );
}
