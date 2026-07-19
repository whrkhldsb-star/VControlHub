/** FEAT-P1-1: ticket SLA calculation, filtering and escalation. */
import { prisma } from "@/lib/db";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { teamWhere } from "@/lib/auth/team-scope";
import type { RoleKey } from "@/lib/auth/rbac";
import { createLogger } from "@/lib/logging";
import { t } from "@/lib/i18n/translations";

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

export function getSlaStatus(ticket: { slaDueAt: Date | null; status: string }, now = new Date()): "ok" | "warning" | "breached" | "none" {
  if (!ticket.slaDueAt || ticket.status === "CLOSED" || ticket.status === "RESOLVED") return "none";
  const remaining = ticket.slaDueAt.getTime() - now.getTime();
  if (remaining < 0) return "breached";
  if (remaining < 60 * 60 * 1000) return "warning";
  return "ok";
}

/**
 * Escalate overdue active tickets. A conditional update inside a transaction
 * acts as the cross-process CAS, so overlapping workers cannot double-escalate.
 * Notifications are limited to ticket managers who belong to the ticket team.
 */
export async function escalateBreachedTickets(): Promise<number> {
  const now = new Date();
  const retryBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const breached = await prisma.ticket.findMany({
    where: {
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
  for (const ticket of breached) {
    const newPriority = ESCALATION_CHAIN[ticket.priority] ?? "HIGH";
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
          data: { priority: newPriority, escalatedAt: now, escalatedTo: ticket.assigneeId },
        });
        if (claimed.count === 0) return false;

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
          where: {
            roles: { some: { role: { permissions: { some: { permission: { key: "ticket:manage" } } } } } },
            ...(ticket.teamId ? { teamMemberships: { some: { teamId: ticket.teamId } } } : {}),
          },
          select: { id: true },
          take: 1000,
        });
        if (managers.length > 0) {
          await tx.notification.createMany({
            data: managers.map((manager) => ({
              userId: manager.id,
              teamId: ticket.teamId,
              title: t("backend.ticket.slaEscalationTitle"),
              message: t("backend.ticket.slaEscalationMessage")
                .replace("{title}", ticket.title)
                .replace("{from}", ticket.priority)
                .replace("{to}", newPriority),
              type: "ticket_escalation",
              actionUrl: `/tickets/${ticket.id}`,
            })),
          });
        }
        return true;
      });

      if (didEscalate) {
        escalated += 1;
        logger.info("Ticket SLA escalated", { ticketId: ticket.id, fromPriority: ticket.priority, toPriority: newPriority });
      }
    } catch (error) {
      logger.error("Failed to escalate ticket", error instanceof Error ? error : undefined, { ticketId: ticket.id });
    }
  }

  logger.info("SLA escalation sweep complete", { breached: breached.length, escalated });
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
  const clauses: Record<string, unknown>[] = [ticketVisibilityWhere(input.session)];
  if (input.status) clauses.push({ status: input.status });
  if (input.priority) clauses.push({ priority: input.priority });
  if (input.category) clauses.push({ category: input.category });
  if (input.assigneeId) clauses.push({ assigneeId: input.assigneeId });
  if (input.search) clauses.push({ OR: [{ title: { contains: input.search, mode: "insensitive" } }, { description: { contains: input.search, mode: "insensitive" } }] });
  if (input.slaStatus === "none") clauses.push({ OR: [{ slaDueAt: null }, { status: { in: ["RESOLVED", "CLOSED"] } }] });
  if (input.slaStatus === "breached") clauses.push({ slaDueAt: { lt: new Date() }, status: { in: ["OPEN", "IN_PROGRESS"] } });

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

  if (input.slaStatus === "warning" || input.slaStatus === "ok") {
    const now = new Date();
    return tickets.filter((ticket) => getSlaStatus(ticket, now) === input.slaStatus);
  }
  return tickets;
}

export async function getTicketKanban(input: { session: TicketSession }) {
  const tickets = await prisma.ticket.findMany({
    where: { AND: [ticketVisibilityWhere(input.session), { status: { in: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] } }] },
    select: {
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
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  const columns: Record<string, typeof tickets> = { OPEN: [], IN_PROGRESS: [], RESOLVED: [], CLOSED: [] };
  for (const ticket of tickets) columns[ticket.status]?.push(ticket);
  return columns;
}
