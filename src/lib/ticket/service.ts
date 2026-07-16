import { ValidationError, ConflictError, NotFoundError } from "@/lib/errors";
import { prisma } from "@/lib/db";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import type { RoleKey } from "@/lib/auth/rbac";

const STATUSES = new Set(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);

type TeamSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null };

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

function ticketTeamFilter(session?: TeamSession | null): Record<string, unknown> {
  return session ? teamWhere(session) : {};
}

export async function createTicket(input: {
  title: string;
  description: string;
  priority?: string;
  createdBy: string;
  relatedServerId?: string;
  relatedCommandId?: string;
  category?: string;
  slaDueAt?: Date;
  session?: { currentTeamId: string | null };
  skipItsmFanOut?: boolean;
}) {
  if (!input.title.trim() || !input.description.trim()) throw new ValidationError("Ticket title and description cannot be empty");
  const priority = input.priority ?? "NORMAL";
  const { computeSlaDueAt } = await import("./sla");
  const slaDueAt = input.slaDueAt ?? computeSlaDueAt(new Date(), priority);
  const ticket = await prisma.ticket.create({
    data: {
      title: input.title.trim(),
      description: input.description.trim(),
      status: "OPEN",
      priority,
      category: input.category,
      slaDueAt,
      createdBy: input.createdBy,
      relatedServerId: input.relatedServerId,
      relatedCommandId: input.relatedCommandId,
      ...(input.session ? teamCreateData(input.session) : {}),
    },
  });
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
      teamId: ticket.teamId,
    });
  }
  return ticket;
}

export async function listTickets(
  input?:
    | {
        userId?: string;
        includeAll?: boolean;
        session?: { userId: string; roles: RoleKey[]; currentTeamId: string | null };
      }
    | string,
) {
  const userId = typeof input === "string" ? input : input?.userId;
  const includeAll = typeof input === "object" ? input.includeAll === true : false;
  const session = typeof input === "object" ? input.session : undefined;
  // Combine participant + team filters with AND. Spreading/Object.assign would
  // overwrite one OR clause with the other when both are present.
  const clauses: Record<string, unknown>[] = [];
  if (!includeAll && userId) {
    clauses.push({ OR: [{ createdBy: userId }, { assigneeId: userId }] });
  }
  if (session) {
    const teamFilter = ticketTeamFilter(session);
    if (Object.keys(teamFilter).length > 0) clauses.push(teamFilter);
  }
  const where =
    clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0]! : { AND: clauses };
  return prisma.ticket.findMany({
    where,
    include: {
      creator: { select: { username: true, displayName: true } },
      assignee: { select: { username: true, displayName: true } },
      comments: { select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
}

/**
 * Load a ticket by id. When `session` is provided, the query is team-scoped
 * via teamWhere so a non-admin cannot read another team's ticket by id
 * (including managers who only have ticket:manage on their own team).
 * System/internal callers may omit session for unscoped lookup.
 */
export async function getTicketById(id: string, session?: TeamSession | null) {
  const teamFilter = ticketTeamFilter(session);
  if (session) {
    return prisma.ticket.findFirst({
      where: { id, ...teamFilter },
      include: {
        creator: { select: { id: true, username: true, displayName: true } },
        assignee: { select: { id: true, username: true, displayName: true } },
        comments: {
          include: { author: { select: { id: true, username: true, displayName: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }
  return prisma.ticket.findUnique({
    where: { id },
    include: {
      creator: { select: { id: true, username: true, displayName: true } },
      assignee: { select: { id: true, username: true, displayName: true } },
      comments: {
        include: { author: { select: { id: true, username: true, displayName: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

/**
 * Participant check (creator/assignee). When session is provided, the ticket
 * must also satisfy teamWhere — prevents cross-team IDOR via shared userIds
 * or guessing ids on foreign-team tickets.
 */
export async function canViewTicket(id: string, userId: string, session?: TeamSession | null) {
  const teamFilter = ticketTeamFilter(session);
  const ticket = session
    ? await prisma.ticket.findFirst({
        where: { id, ...teamFilter },
        select: { createdBy: true, assigneeId: true },
      })
    : await prisma.ticket.findUnique({
        where: { id },
        select: { createdBy: true, assigneeId: true },
      });
  return ticket?.createdBy === userId || ticket?.assigneeId === userId;
}

export async function updateTicketStatus(input: {
  id: string;
  status?: string;
  assigneeId?: string | null;
  priority?: string;
  skipItsmFanOut?: boolean;
  session?: TeamSession | null;
}) {
  const data: { status?: string; assigneeId?: string | null; closedAt?: Date | null; priority?: string } = {};
  const teamFilter = ticketTeamFilter(input.session);

  if (input.status !== undefined) {
    if (!STATUSES.has(input.status)) throw new ValidationError("Ticket status is invalid");
    // Enforce the state machine with CAS so concurrent PATCHes cannot
    // both win illegal transitions (e.g. OPEN→IN_PROGRESS and OPEN→CLOSED).
    const current = input.session
      ? await prisma.ticket.findFirst({ where: { id: input.id, ...teamFilter }, select: { status: true } })
      : await prisma.ticket.findUnique({ where: { id: input.id }, select: { status: true } });
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
      where: { id: input.id, status: current.status, ...teamFilter },
      data,
    });
    if (claimed.count === 0) {
      throw new ConflictError("Ticket status changed concurrently; please retry");
    }
    const updated = input.session
      ? await prisma.ticket.findFirst({ where: { id: input.id, ...teamFilter } })
      : await prisma.ticket.findUnique({ where: { id: input.id } });
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
        teamId: updated.teamId,
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

  // Team-scoped update: claim via updateMany so cross-team ids cannot mutate.
  if (input.session) {
    const claimed = await prisma.ticket.updateMany({
      where: { id: input.id, ...teamFilter },
      data,
    });
    if (claimed.count === 0) throw new NotFoundError("Ticket not found");
    const updated = await prisma.ticket.findFirst({ where: { id: input.id, ...teamFilter } });
    if (!updated) throw new NotFoundError("Ticket not found");
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
        teamId: updated.teamId,
      });
    }
    return updated;
  }

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
      teamId: updated.teamId,
    });
  }
  return updated;
}

export async function addTicketComment(input: {
  ticketId: string;
  authorId: string;
  body: string;
  skipItsmFanOut?: boolean;
  session?: TeamSession | null;
}) {
  if (!input.body.trim()) throw new ValidationError("Reply content cannot be empty");
  const teamFilter = ticketTeamFilter(input.session);
  if (input.session) {
    const ticketExists = await prisma.ticket.findFirst({
      where: { id: input.ticketId, ...teamFilter },
      select: { id: true },
    });
    if (!ticketExists) throw new NotFoundError("Ticket not found");
  }
  const comment = await prisma.ticketComment.create({
    data: { ticketId: input.ticketId, authorId: input.authorId, body: input.body.trim() },
    include: { author: { select: { id: true, username: true, displayName: true } } },
  });
  if (!input.skipItsmFanOut) {
    const ticket = input.session
      ? await prisma.ticket.findFirst({ where: { id: input.ticketId, ...teamFilter } })
      : await prisma.ticket.findUnique({ where: { id: input.ticketId } });
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
        teamId: ticket.teamId,
      });
    }
  }
  return comment;
}
