import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { canViewTicket, getTicketById } from "@/lib/ticket/service";
import { PageShell, EmptyState, PageHeader } from "@/components/page-shell";
import { TicketDetailClient, type Ticket } from "./ticket-detail-client";
import { notFound } from "next/navigation";
import { getServerLocale, t } from "@/lib/i18n/translations";

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
      <TicketDetailClient initial={serialized} canManage={canManage} locale={locale} />
    </PageShell>
  );
}
