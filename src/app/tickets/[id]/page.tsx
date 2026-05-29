import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { canViewTicket, getTicketById } from "@/lib/ticket/service";
import { PageShell, EmptyState } from "@/components/page-shell";
import { TicketDetailClient, type Ticket } from "./ticket-detail-client";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("/tickets");
  const { id } = await params;
  const canManage = sessionHasPermission(session, "ticket:manage");
  if (!canManage && !(await canViewTicket(id, session.userId))) {
    return <PageShell><EmptyState text="你只能查看自己提交或分配给你的工单。" /></PageShell>;
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
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/70">Ticket Detail</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">工单详情</h1>
      </header>
      <TicketDetailClient initial={serialized} canManage={canManage} />
    </PageShell>
  );
}
