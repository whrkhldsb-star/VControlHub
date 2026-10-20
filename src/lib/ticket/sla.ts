/** FEAT-P1-1: ticket SLA calculation, filtering and escalation. */
import { prisma } from "@/lib/db";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { teamWhere } from "@/lib/auth/team-scope";
import type { RoleKey } from "@/lib/auth/rbac";
import { createLogger } from "@/lib/logging";
import { notificationContentData } from "@/lib/notification/service";
import { permissionHoldersWhere } from "@/lib/auth/permission-holders";
import { SLA_WARNING_MS, ticketQueryClauses } from "./query";

const logger = createLogger("ticket-sla");

type TicketSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null };

export const SLA_DURATIONS_MS: Record<string, number> = {
  URGENT: 2 * 60 * 60 * 1000,
  HIGH: 8 * 60 * 60 * 1000,
  NORMAL: 24 * 60 * 60 * 1000,
  LOW: 72 * 60 * 60 * 1000,
};

const ESCALATION_CHAIN: Record<string, string> = {
  LOW: "NORMAL",
  NORMAL: "HIGH",
  HIGH: "URGENT",
  URGENT: "URGENT",
};

export function computeSlaDueAt(createdAt: Date, priority: string): Date {
  const duration = SLA_DURATIONS_MS[priority] ?? SLA_DURATIONS_MS.NORMAL ?? 24 * 60 * 60 * 1000;
  return new Date(createdAt.getTime() + duration);
}

export function isSlaBreached(ticket: { slaDueAt: Date | null; status: string }, now = new Date()): boolean {
  if (!ticket.slaDueAt || ticket.status === "CLOSED" || ticket.status === "RESOLVED") return false;
  return ticket.slaDueAt.getTime() < now.getTime();
}

/** An active ticket is in "warning" for the last hour before its SLA is due. */

export function getSlaStatus(ticket: { slaDueAt: Date | null; status: string }, now = new Date()): "ok" | "warning" | "breached" | "none" {
  if (!ticket.slaDueAt || ticket.status === "CLOSED" || ticket.status === "RESOLVED") return "none";
  const remaining = ticket.slaDueAt.getTime() - now.getTime();
  if (remaining < 0) return "breached";
  if (remaining < SLA_WARNING_MS) return "warning";
  return "ok";
}

/**
 * Escalate overdue active tickets. A conditional update inside a transaction
 * acts as the cross-process CAS, so overlapping workers cannot double-escalate.
 * Notifications are limited to ticket managers who belong to the ticket team.
 */
export async function escalateBreachedTickets(input: { teamId?: string | null } = {}): Promise<number> {
  const now = new Date();
  const retryBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const breached = await prisma.ticket.findMany({
    where: {
      ...(input.teamId !== undefined ? { teamId: input.teamId } : {}),
      slaDueAt: { lt: now },
      status: { in: ["OPEN", "IN_PROGRESS"] },
      OR: [{ escalatedAt: null }, { escalatedAt: { lt: retryBefore } }],
    },
    select: {
      id: true,
      teamId: true,
      status: true,
      priority: true,
      assigneeId: true,
      title: true,
      slaDueAt: true,
      escalatedAt: true,
    },
    take: 100,
  });

  let escalated = 0;
  const failedTicketIds: string[] = [];
  for (const ticket of breached) {
    const newPriority = ESCALATION_CHAIN[ticket.priority] ?? "HIGH";
    // Already at the top of the chain (URGENT→URGENT): still stamp escalatedAt so the
    // hourly re-sweep does not re-notify managers, but do not write a no-op escalation row.
    const priorityChanges = newPriority !== ticket.priority;
    try {
      const didEscalate = await prisma.$transaction(async (tx) => {
        const claimed = await tx.ticket.updateMany({
          where: {
            id: ticket.id,
            status: ticket.status,
            priority: ticket.priority,
            slaDueAt: { lt: now },
            ...(ticket.escalatedAt ? { escalatedAt: ticket.escalatedAt } : { escalatedAt: null }),
          },
          data: {
            ...(priorityChanges ? { priority: newPriority } : {}),
            escalatedAt: now,
            escalatedTo: ticket.assigneeId,
          },
        });
        if (claimed.count === 0) return false;

        if (priorityChanges) {
          await tx.ticketEscalation.create({
            data: {
              ticketId: ticket.id,
              fromStatus: ticket.status,
              toStatus: ticket.status,
              fromPriority: ticket.priority,
              toPriority: newPriority,
              fromAssignee: ticket.assigneeId,
              toAssignee: ticket.assigneeId,
              reason: `SLA breach: due ${ticket.slaDueAt?.toISOString()}`,
            },
          });

          const managers = await tx.user.findMany({
            where: { status: { not: "DISABLED" }, ...permissionHoldersWhere("ticket:manage", ticket.teamId) },
            select: { id: true },
            take: 1000,
          });
          if (managers.length > 0) {
            await tx.notification.createMany({
              data: managers.map((manager) => ({
                userId: manager.id,
                teamId: ticket.teamId,
                ...notificationContentData({
                  notice: {
                    code: "ticketSlaEscalated",
                    params: {
                      title: ticket.title,
                      fromKey: `ticketsDetail.priority.${ticket.priority}`,
                      toKey: `ticketsDetail.priority.${newPriority}`,
                    },
                  },
                }),
                type: "ticket_escalation",
                actionUrl: `/tickets/${ticket.id}`,
              })),
            });
          }
        }
        return true;
      });

      if (didEscalate) {
        if (priorityChanges) {
          escalated += 1;
          logger.info("Ticket SLA escalated", { ticketId: ticket.id, fromPriority: ticket.priority, toPriority: newPriority });
        } else {
          logger.debug("Ticket SLA already at max priority; marked escalatedAt without re-notify", {
            ticketId: ticket.id,
            priority: ticket.priority,
          });
        }
      }
    } catch (error) {
      failedTicketIds.push(ticket.id);
      logger.error("Failed to escalate ticket", error instanceof Error ? error : undefined, { ticketId: ticket.id });
    }
  }

  const context = { breached: breached.length, escalated };
  if (breached.length > 0) logger.info("SLA escalation sweep complete", context);
  else logger.debug("SLA escalation sweep complete", context);
  if (failedTicketIds.length > 0) {
    throw new Error(`Failed to escalate ${failedTicketIds.length} of ${breached.length} ticket(s): ${failedTicketIds.join(", ")}`);
  }
  return escalated;
}

function ticketVisibilityWhere(session: TicketSession): Record<string, unknown> {
  if (sessionHasPermission(session, "ticket:manage")) return teamWhere(session);
  return {
    AND: [
      teamWhere(session),
      { OR: [{ createdBy: session.userId }, { assigneeId: session.userId }] },
    ],
  };
}

export async function listTicketsAdvanced(input: {
  session: TicketSession;
  status?: string;
  priority?: string;
  category?: string;
  assigneeId?: string;
  slaStatus?: "ok" | "warning" | "breached" | "none";
  search?: string;
}) {
  const clauses = [ticketVisibilityWhere(input.session), ...ticketQueryClauses(input, new Date())];

  const tickets = await prisma.ticket.findMany({
    where: { AND: clauses },
    include: {
      creator: { select: { id: true, username: true, displayName: true } },
      assignee: { select: { id: true, username: true, displayName: true } },
      comments: { select: { id: true, body: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  return tickets;
}

/** Per board column: open work in full (up to the first), finished work as recent history. */
const KANBAN_ACTIVE_LIMIT = 1000;
const KANBAN_DONE_LIMIT = 200;

/**
 * The board's columns, each read on its own. One "latest 200 of all statuses"
 * read let recently closed tickets push older open or in-progress ones off
 * the board altogether.
 */
export async function getTicketKanban(input: { session: TicketSession }) {
  const select = {
    id: true,
    title: true,
    status: true,
    priority: true,
    category: true,
    slaDueAt: true,
    escalatedAt: true,
    assigneeId: true,
    assignee: { select: { id: true, username: true, displayName: true } },
    updatedAt: true,
  } as const;
  const visible = ticketVisibilityWhere(input.session);
  const column = (status: string, take: number) => prisma.ticket.findMany({
    where: { AND: [visible, { status }] },
    select,
    orderBy: { updatedAt: "desc" },
    take,
  });
  const [open, inProgress, resolved, closed] = await Promise.all([
    column("OPEN", KANBAN_ACTIVE_LIMIT),
    column("IN_PROGRESS", KANBAN_ACTIVE_LIMIT),
    column("RESOLVED", KANBAN_DONE_LIMIT),
    column("CLOSED", KANBAN_DONE_LIMIT),
  ]);
  return { OPEN: open, IN_PROGRESS: inProgress, RESOLVED: resolved, CLOSED: closed };
}
