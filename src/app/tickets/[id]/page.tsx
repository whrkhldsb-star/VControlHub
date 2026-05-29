import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getTicketById } from "@/lib/ticket/service";
import { PageShell, EmptyState } from "@/components/page-shell";
import { TicketDetailClient } from "./ticket-detail-client";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TicketDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("/tickets");
  if (!sessionHasPermission(session, "ticket:manage")) {
    return <PageShell><EmptyState text="你没有工单管理权限。" /></PageShell>;
  }
  const { id } = await params;
  const ticket = await getTicketById(id);
  if (!ticket) notFound();

  // Serialize dates for client component
  const serialized = {
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
      <TicketDetailClient initial={serialized as any} />
    </PageShell>
  );
}
