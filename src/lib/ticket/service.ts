import { ValidationError, NotFoundError } from "@/lib/errors";
import { projectTicket, projectTicketLinks } from "./visible-links";
import { prisma } from "@/lib/db";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { lockTicket, withTicketTransaction } from "./transaction";
import { enqueueTicketEvent } from "@/lib/itsm/outbox";
import type { Prisma } from "@prisma/client";
import { serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import type { RoleKey } from "@/lib/auth/rbac";
import { t } from "@/lib/i18n/service-translations";

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

/**
 * Validate optional related server/command ids under the caller's team boundary.
 * Without this, POST /api/tickets (and any sessioned create path) can stamp a
 * foreign-team serverId/commandRequestId onto a new ticket — same class of
 * cross-tenant link IDOR already fixed on timeline link_* actions.
 */
async function assertRelatedResourcesInTeamScope(
  tx: Prisma.TransactionClient,
  input: {
    relatedServerId?: string | null;
    relatedCommandId?: string | null;
  },
  session?: Pick<TeamSession, "userId" | "roles" | "currentTeamId"> | null,
) {
  if (!session) return;
  const scope = teamWhere(session);
  if (input.relatedServerId) {
    const server = await tx.server.findFirst({
      where: { id: input.relatedServerId, ...serverTeamWhere(session) },
      select: { id: true },
    });
    if (!server) throw new ValidationError(t("backend.ticket.relatedServerNotFound"));
  }
  if (input.relatedCommandId) {
    const cmd = await tx.commandRequest.findFirst({
      where: { id: input.relatedCommandId, ...scope },
      select: { id: true },
    });
    if (!cmd) throw new ValidationError(t("backend.ticket.relatedCommandRequestNotFound"));
  }
}

/**
 * When assigning a ticket, ensure the assignee is a member of the ticket's
 * team (or the caller's current team). Prevents managers from writing
 * arbitrary foreign-tenant userIds into assigneeId via PATCH.
 */
async function assertAssigneeInTeamScope(
  tx: Prisma.TransactionClient,
  assigneeId: string | null | undefined,
  session?: TeamSession | null,
  ticketTeamId?: string | null,
) {
  if (!assigneeId || !session) return;
  // Platform admins may assign anyone.
  if (sessionHasPermission(session, "team:manage")) return;

  const teamId = ticketTeamId ?? session.currentTeamId;
  if (!teamId) {
    // No team context: only allow self-assignment.
    if (assigneeId !== session.userId) {
      throw new ValidationError(t("backend.ticket.assigneeIsNotAvailableInThisTeam"));
    }
    return;
  }

  if (assigneeId === session.userId) return;

  const membership = await tx.teamMember.findUnique({
    where: { teamId_userId: { teamId, userId: assigneeId } },
    select: { userId: true },
  });
  if (!membership) throw new ValidationError(t("backend.ticket.assigneeIsNotAMemberOfThisTeam"));
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
  session?: Pick<TeamSession, "userId" | "roles" | "currentTeamId"> | { currentTeamId: string | null };
  skipItsmFanOut?: boolean;
  db?: Prisma.TransactionClient;
}) {
  if (!input.title.trim() || !input.description.trim()) throw new ValidationError(t("backend.ticket.ticketTitleAndDescriptionCannotBeEmpty"));
  const priority = input.priority ?? "NORMAL";
  const { computeSlaDueAt } = await import("./sla");
  const slaDueAt = input.slaDueAt ?? computeSlaDueAt(new Date(), priority);

  // Prefer full team session (roles + team) when available so related links are scoped.
  const teamSession =
    input.session && "roles" in input.session && Array.isArray(input.session.roles)
      ? (input.session as TeamSession)
      : null;
  return withTicketTransaction(input.db, async (tx) => {
    await assertRelatedResourcesInTeamScope(tx, input, teamSession);
    const ticket = await tx.ticket.create({
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
    if (!input.skipItsmFanOut) await enqueueTicketEvent(tx, ticket, "ticket.created");
    return ticket;
  });
}

export type TicketListInput =
  | {
      userId?: string;
      includeAll?: boolean;
      session?: { userId: string; roles: RoleKey[]; currentTeamId: string | null };
    }
  | string;

/** Which tickets the caller's list covers (participant and customer filters). */
export function ticketListWhere(input?: TicketListInput): Prisma.TicketWhereInput {
  const userId = typeof input === "string" ? input : input?.userId;
  const includeAll = typeof input === "object" ? input.includeAll === true : false;
  const session = typeof input === "object" ? input.session : undefined;
  // Combine participant + team filters with AND. Spreading/Object.assign would
  // overwrite one OR clause with the other when both are present.
  const clauses: Prisma.TicketWhereInput[] = [];
  if (!includeAll && userId) {
    clauses.push({ OR: [{ createdBy: userId }, { assigneeId: userId }] });
  }
  if (session) {
    const teamFilter = ticketTeamFilter(session);
    if (Object.keys(teamFilter).length > 0) clauses.push(teamFilter);
  }
  return clauses.length === 0 ? {} : clauses.length === 1 ? clauses[0]! : { AND: clauses };
}

const TICKET_LIST_INCLUDE = {
  creator: { select: { username: true, displayName: true } },
  assignee: { select: { username: true, displayName: true } },
  comments: { select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
} satisfies Prisma.TicketInclude;

/** Open work shown however old it is; finished tickets only as recent history. */
const ACTIVE_TICKET_LIMIT = 1000;
const RECENT_TICKET_LIMIT = 200;

/**
 * The ticket workspace list: every open or in-progress ticket (up to
 * ACTIVE_TICKET_LIMIT) plus the most recently updated ones. Only the latest
 * 200 used to be read, so an old pending ticket close to its SLA deadline was
 * hidden behind recently closed ones and missing from every filter.
 */
export async function listTickets(input?: TicketListInput) {
  const where = ticketListWhere(input);
  const [active, recent] = await Promise.all([
    prisma.ticket.findMany({
      where: { AND: [where, { status: { in: ["OPEN", "IN_PROGRESS"] } }] },
      include: TICKET_LIST_INCLUDE,
      orderBy: { updatedAt: "desc" },
      take: ACTIVE_TICKET_LIMIT,
    }),
    prisma.ticket.findMany({
      where,
      include: TICKET_LIST_INCLUDE,
      orderBy: { updatedAt: "desc" },
      take: RECENT_TICKET_LIMIT,
    }),
  ]);
  const byId = new Map([...active, ...recent].map((ticket) => [ticket.id, ticket]));
  const rows = [...byId.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return typeof input === "object" && input.session ? projectTicketLinks(rows, input.session) : rows;
}

/** Status and high-priority counts over every ticket the list covers, not just the loaded rows. */
export async function countTickets(input?: TicketListInput) {
  const where = ticketListWhere(input);
  const [byStatus, urgent] = await Promise.all([
    prisma.ticket.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.ticket.count({ where: { AND: [where, { priority: { in: ["URGENT", "HIGH"] } }] } }),
  ]);
  const count = (status: string) => byStatus.find((row) => row.status === status)?._count._all ?? 0;
  return { open: count("OPEN"), inProgress: count("IN_PROGRESS"), resolved: count("RESOLVED") + count("CLOSED"), urgent };
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
    const row = await prisma.ticket.findFirst({
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
    return row ? projectTicket(row, session) : null;
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
  db?: Prisma.TransactionClient;
  session?: TeamSession | null;
}) {
  if (input.status !== undefined && !STATUSES.has(input.status)) throw new ValidationError(t("backend.ticket.ticketStatusIsInvalid"));
  if (input.status === undefined && input.priority === undefined && input.assigneeId === undefined) {
    throw new ValidationError(t("backend.ticket.ticketUpdateContentCannotBeEmpty"));
  }
  return withTicketTransaction(input.db, async (tx) => {
    await lockTicket(tx, input.id);
    const where = { id: input.id, ...ticketTeamFilter(input.session) };
    const current = await tx.ticket.findUnique({ where });
    if (!current) throw new NotFoundError(t("backend.ticket.ticketNotFound"));
    if (input.status !== undefined && !TRANSITIONS[current.status]?.has(input.status)) {
      throw new ValidationError(t("backend.ticket.ticketStatusTransitionInvalid", { from: current.status, to: input.status }));
    }
    await assertAssigneeInTeamScope(tx, input.assigneeId, input.session, current.teamId);
    const { ticketSlaUpdate } = await import("./sla");
    const updated = await tx.ticket.update({
      where,
      data: {
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.status !== undefined ? { status: input.status, closedAt: input.status === "CLOSED" ? new Date() : null } : {}),
        ...ticketSlaUpdate(current, input),
      },
    });
    if (input.status !== undefined) {
      await tx.ticketEscalation.create({ data: {
        ticketId: input.id,
        fromStatus: current.status, toStatus: updated.status,
        fromPriority: current.priority, toPriority: updated.priority,
        fromAssignee: current.assigneeId, toAssignee: updated.assigneeId,
        escalatedBy: input.session?.userId ?? null,
      } });
    }
    if (!input.skipItsmFanOut) {
      await enqueueTicketEvent(tx, updated, input.status === undefined ? "ticket.updated" : "ticket.status_changed");
    }
    return updated;
  });
}

export async function addTicketComment(input: {
  ticketId: string;
  authorId: string;
  body: string;
  skipItsmFanOut?: boolean;
  db?: Prisma.TransactionClient;
  session?: TeamSession | null;
}) {
  if (!input.body.trim()) throw new ValidationError(t("backend.ticket.replyContentCannotBeEmpty"));
  return withTicketTransaction(input.db, async (tx) => {
    await lockTicket(tx, input.ticketId);
    const session = input.session;
    const scope = ticketListWhere(session ? {
      session, userId: session.userId, includeAll: sessionHasPermission(session, "ticket:manage"),
    } : undefined);
    const ticket = await tx.ticket.findFirst({ where: { id: input.ticketId, ...scope } });
    if (!ticket) throw new NotFoundError(t("backend.ticket.ticketNotFound"));
    const comment = await tx.ticketComment.create({
      data: { ticketId: ticket.id, authorId: input.authorId, body: input.body.trim() },
      include: { author: { select: { id: true, username: true, displayName: true } } },
    });
    if (!input.skipItsmFanOut) await enqueueTicketEvent(tx, ticket, "ticket.comment", comment.body);
    return comment;
  });
}
