import { ValidationError, ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";

const STATUSES = new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

/**
 * Valid status transitions. Mirrors the TRANSITIONS map in
 * `ticket-detail-client.tsx` so the UI and API enforce the same state
 * machine. A CLOSED ticket can only be re-opened to OPEN; the agent must
 * then drive it through IN_PROGRESS→RESOLVED→CLOSED again if it needs to
 * be re-closed. This keeps the audit trail and the `closedAt` invariant
 * consistent.
 *
 * Server-side enforcement matters because the UI restriction is only
 * client-side; an authenticated API caller could otherwise PATCH a
 * CLOSED ticket straight to OPEN, skipping the state machine entirely.
 */
const TRANSITIONS: Record<string, Set<string>> = {
  OPEN: new Set(["IN_PROGRESS"]),
  IN_PROGRESS: new Set(["RESOLVED", "OPEN"]),
  RESOLVED: new Set(["CLOSED", "IN_PROGRESS"]),
  CLOSED: new Set(["OPEN"]),
};

export async function createTicket(input: { title: string; description: string; priority?: string; createdBy: string; relatedServerId?: string; relatedCommandId?: string; category?: string; slaDueAt?: Date; session?: { currentTeamId: string | null }; skipItsmFanOut?: boolean }) {
  if (!input.title.trim() || !input.description.trim()) throw new ValidationError("Ticket title and description cannot be empty");
  const priority = input.priority ?? "NORMAL";
  const { computeSlaDueAt } = await import("./sla");
  const slaDueAt = input.slaDueAt ?? computeSlaDueAt(new Date(), priority);
  const ticket = await prisma.ticket.create({ data: { title: input.title.trim(), description: input.description.trim(), status: "OPEN", priority, category: input.category, slaDueAt, createdBy: input.createdBy, relatedServerId: input.relatedServerId, relatedCommandId: input.relatedCommandId, ...(input.session ? teamCreateData(input.session) : {}) } });
  if (!input.skipItsmFanOut) {
    const { safeFanOutTicketEvent } = await import("@/lib/itsm/service");
    await safeFanOutTicketEvent({
      ticketId: ticket.id,
      eventType: "ticket.created",
      title: ticket.title,
      description: ticket.description,
      status: ticket.status,
      priority: ticket.priority,
      category: ticket.category,
    });
  }
  return ticket;
}

export async function listTickets(input?: { userId?: string; includeAll?: boolean; session?: { userId: string; roles: import("@/lib/auth/rbac").RoleKey[]; currentTeamId: string | null } } | string) {
  const userId = typeof input === "string" ? input : input?.userId;
  const includeAll = typeof input === "object" ? input.includeAll === true : false;
  const session = typeof input === "object" ? input.session : undefined;
  const teamFilter = session ? teamWhere(session) : {};
  const baseWhere: Record<string, unknown> = !includeAll && userId ? { OR: [{ createdBy: userId }, { assigneeId: userId }] } : {};
  if (session) Object.assign(baseWhere, teamFilter);
  return prisma.ticket.findMany({
    where: baseWhere,
    include: {
      creator: { select: { username: true, displayName: true } },
      assignee: { select: { username: true, displayName: true } },
      comments: { select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}

export async function getTicketById(id: string) {
  return prisma.ticket.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, username: true, displayName: true } },
      assignee: { select: { id: true, username: true, displayName: true } },
      comments: { include: { author: { select: { id: true, username: true, displayName: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
}

export async function canViewTicket(id: string, userId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id },
    select: { createdBy: true, assigneeId: true },
  });
  return ticket?.createdBy === userId || ticket?.assigneeId === userId;
}

export async function updateTicketStatus(input: { id: string; status?: string; assigneeId?: string | null; priority?: string; skipItsmFanOut?: boolean }) {
  const data: { status?: string; assigneeId?: string | null; closedAt?: Date | null; priority?: string } = {};

  if (input.status !== undefined) {
    if (!STATUSES.has(input.status)) throw new ValidationError("Ticket status is invalid");
    // Enforce the state machine with CAS so concurrent PATCHes cannot
    // both win illegal transitions (e.g. OPEN→IN_PROGRESS and OPEN→CLOSED).
    const current = await prisma.ticket.findUnique({ where: { id: input.id }, select: { status: true } });
    if (!current) throw new NotFoundError("Ticket not found");
    const allowed = TRANSITIONS[current.status] ?? new Set<string>();
    if (!allowed.has(input.status)) {
      throw new ValidationError(`Ticket status cannot change from ${current.status} to ${input.status}`);
    }
    data.status = input.status;
    data.closedAt = input.status === "CLOSED" ? new Date() : null;

    if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId;
    if (input.priority !== undefined) data.priority = input.priority;

    const claimed = await prisma.ticket.updateMany({
      where: { id: input.id, status: current.status },
      data,
    });
    if (claimed.count === 0) {
      throw new ConflictError("Ticket status changed concurrently; please retry");
    }
    const updated = await prisma.ticket.findUnique({ where: { id: input.id } });
    if (!updated) throw new NotFoundError("Ticket not found");
    if (!input.skipItsmFanOut) {
      const { safeFanOutTicketEvent } = await import("@/lib/itsm/service");
      await safeFanOutTicketEvent({
        ticketId: updated.id,
        eventType: "ticket.status_changed",
        title: updated.title,
        description: updated.description,
        status: updated.status,
        priority: updated.priority,
        category: updated.category,
      });
    }
    return updated;
  }

  if (input.assigneeId !== undefined) {
    data.assigneeId = input.assigneeId;
  }

  if (input.priority !== undefined) {
    data.priority = input.priority;
  }

  if (Object.keys(data).length === 0) throw new ValidationError("Ticket update content cannot be empty");

  const updated = await prisma.ticket.update({ where: { id: input.id }, data });
  if (!input.skipItsmFanOut) {
    const { safeFanOutTicketEvent } = await import("@/lib/itsm/service");
    await safeFanOutTicketEvent({
      ticketId: updated.id,
      eventType: "ticket.updated",
      title: updated.title,
      description: updated.description,
      status: updated.status,
      priority: updated.priority,
      category: updated.category,
    });
  }
  return updated;
}

export async function addTicketComment(input: { ticketId: string; authorId: string; body: string; skipItsmFanOut?: boolean }) {
  if (!input.body.trim()) throw new ValidationError("Reply content cannot be empty");
  const comment = await prisma.ticketComment.create({
    data: { ticketId: input.ticketId, authorId: input.authorId, body: input.body.trim() },
    include: { author: { select: { id: true, username: true, displayName: true } } },
  });
  if (!input.skipItsmFanOut) {
    const ticket = await prisma.ticket.findUnique({ where: { id: input.ticketId } });
    if (ticket) {
      const { safeFanOutTicketEvent } = await import("@/lib/itsm/service");
      await safeFanOutTicketEvent({
        ticketId: ticket.id,
        eventType: "ticket.comment",
        title: ticket.title,
        description: ticket.description,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        commentBody: comment.body,
      });
    }
  }
  return comment;
}
