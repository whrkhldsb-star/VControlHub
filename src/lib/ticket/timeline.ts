/**
 * Ticket ↔ CommandRequest bidirectional timeline.
 *
 * Sources merged chronologically:
 * - ticket created / closed
 * - ticket status transitions (TicketEscalation)
 * - ticket comments
 * - linked command request lifecycle (created, approvals, execution logs, target finish)
 * - reverse: other tickets that point at the same command
 */
import type { RoleKey } from "@/lib/auth/rbac";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";

type TeamSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null };

function ticketTeamFilter(session?: TeamSession | null): Record<string, unknown> {
  return session ? teamWhere(session) : {};
}


export type TimelineEventType =
  | "ticket.created"
  | "ticket.status"
  | "ticket.comment"
  | "ticket.closed"
  | "ticket.linked_command"
  | "ticket.linked_server"
  | "command.created"
  | "command.approval"
  | "command.execution"
  | "command.target"
  | "command.status";

export type TimelineEvent = {
  id: string;
  at: string;
  type: TimelineEventType;
  title: string;
  detail?: string | null;
  actor?: string | null;
  meta?: Record<string, unknown>;
};

function actorName(user?: { username: string; displayName: string | null } | null): string | null {
  if (!user) return null;
  return user.displayName || user.username;
}

export async function linkTicketCommand(input: {
  ticketId: string;
  commandRequestId: string | null;
  actorId?: string;
  session?: TeamSession | null;
}) {
  const teamFilter = ticketTeamFilter(input.session);
  const ticket = input.session
    ? await prisma.ticket.findFirst({
        where: { id: input.ticketId, ...teamFilter },
        select: { id: true, relatedCommandId: true, status: true },
      })
    : await prisma.ticket.findUnique({
        where: { id: input.ticketId },
        select: { id: true, relatedCommandId: true, status: true },
      });
  if (!ticket) throw new NotFoundError("Ticket not found");

  if (input.commandRequestId) {
    const cmd = input.session
      ? await prisma.commandRequest.findFirst({
          where: { id: input.commandRequestId, ...teamWhere(input.session) },
          select: { id: true, title: true, status: true },
        })
      : await prisma.commandRequest.findUnique({
          where: { id: input.commandRequestId },
          select: { id: true, title: true, status: true },
        });
    if (!cmd) throw new ValidationError("Command request not found");
  }

  const previous = ticket.relatedCommandId;
  if (input.session) {
    const claimed = await prisma.ticket.updateMany({
      where: { id: input.ticketId, ...teamFilter },
      data: { relatedCommandId: input.commandRequestId },
    });
    if (claimed.count === 0) throw new NotFoundError("Ticket not found");
  } else {
    await prisma.ticket.update({
      where: { id: input.ticketId },
      data: { relatedCommandId: input.commandRequestId },
    });
  }
  const updated = input.session
    ? await prisma.ticket.findFirst({ where: { id: input.ticketId, ...teamFilter } })
    : await prisma.ticket.findUnique({ where: { id: input.ticketId } });
  if (!updated) throw new NotFoundError("Ticket not found");

  if (previous !== input.commandRequestId) {
    await prisma.ticketEscalation.create({
      data: {
        ticketId: input.ticketId,
        fromStatus: ticket.status,
        toStatus: ticket.status,
        reason: input.commandRequestId
          ? `Linked command request ${input.commandRequestId}`
          : previous
            ? `Unlinked command request ${previous}`
            : "Command link updated",
        escalatedBy: input.actorId ?? null,
      },
    });
  }

  return updated;
}

export async function linkTicketServer(input: {
  ticketId: string;
  serverId: string | null;
  actorId?: string;
  session?: TeamSession | null;
}) {
  const teamFilter = ticketTeamFilter(input.session);
  const ticket = input.session
    ? await prisma.ticket.findFirst({
        where: { id: input.ticketId, ...teamFilter },
        select: { id: true, relatedServerId: true, status: true },
      })
    : await prisma.ticket.findUnique({
        where: { id: input.ticketId },
        select: { id: true, relatedServerId: true, status: true },
      });
  if (!ticket) throw new NotFoundError("Ticket not found");

  if (input.serverId) {
    const server = input.session
      ? await prisma.server.findFirst({
          where: { id: input.serverId, ...teamWhere(input.session) },
          select: { id: true },
        })
      : await prisma.server.findUnique({
          where: { id: input.serverId },
          select: { id: true },
        });
    if (!server) throw new ValidationError("Server not found");
  }

  const previous = ticket.relatedServerId;
  if (input.session) {
    const claimed = await prisma.ticket.updateMany({
      where: { id: input.ticketId, ...teamFilter },
      data: { relatedServerId: input.serverId },
    });
    if (claimed.count === 0) throw new NotFoundError("Ticket not found");
  } else {
    await prisma.ticket.update({
      where: { id: input.ticketId },
      data: { relatedServerId: input.serverId },
    });
  }
  const updated = input.session
    ? await prisma.ticket.findFirst({ where: { id: input.ticketId, ...teamFilter } })
    : await prisma.ticket.findUnique({ where: { id: input.ticketId } });
  if (!updated) throw new NotFoundError("Ticket not found");

  if (previous !== input.serverId) {
    await prisma.ticketEscalation.create({
      data: {
        ticketId: input.ticketId,
        fromStatus: ticket.status,
        toStatus: ticket.status,
        reason: input.serverId
          ? `Linked server ${input.serverId}`
          : previous
            ? `Unlinked server ${previous}`
            : "Server link updated",
        escalatedBy: input.actorId ?? null,
      },
    });
  }

  return updated;
}

export async function getTicketTimeline(ticketId: string, session?: TeamSession | null): Promise<{
  ticketId: string;
  events: TimelineEvent[];
  related: {
    server: { id: string; name: string; host: string } | null;
    command: {
      id: string;
      title: string;
      command: string;
      status: string;
      createdAt: string;
    } | null;
    reverseTickets: Array<{ id: string; title: string; status: string }>;
  };
}> {
  const teamFilter = ticketTeamFilter(session);
  const ticketInclude = {
    creator: { select: { username: true, displayName: true } },
    assignee: { select: { username: true, displayName: true } },
    comments: {
      include: { author: { select: { username: true, displayName: true } } },
      orderBy: { createdAt: "asc" as const },
    },
    escalations: { orderBy: { createdAt: "asc" as const } },
  };
  const ticket = session
    ? await prisma.ticket.findFirst({
        where: { id: ticketId, ...teamFilter },
        include: ticketInclude,
      })
    : await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: ticketInclude,
      });
  if (!ticket) throw new NotFoundError("Ticket not found");

  const events: TimelineEvent[] = [];

  events.push({
    id: `ticket-created-${ticket.id}`,
    at: ticket.createdAt.toISOString(),
    type: "ticket.created",
    title: "Ticket created",
    detail: ticket.title,
    actor: actorName(ticket.creator),
    meta: { priority: ticket.priority, status: ticket.status },
  });

  if (ticket.relatedServerId) {
    events.push({
      id: `ticket-server-${ticket.id}`,
      at: ticket.createdAt.toISOString(),
      type: "ticket.linked_server",
      title: "Linked VPS",
      detail: ticket.relatedServerId,
      meta: { serverId: ticket.relatedServerId },
    });
  }

  for (const esc of ticket.escalations) {
    const isLink =
      (esc.reason ?? "").includes("Linked command") ||
      (esc.reason ?? "").includes("Unlinked command") ||
      (esc.reason ?? "").includes("Linked server") ||
      (esc.reason ?? "").includes("Unlinked server");
    events.push({
      id: `esc-${esc.id}`,
      at: esc.createdAt.toISOString(),
      type: isLink
        ? esc.reason?.includes("server")
          ? "ticket.linked_server"
          : "ticket.linked_command"
        : "ticket.status",
      title: isLink
        ? esc.reason ?? "Link updated"
        : `Status ${esc.fromStatus}${esc.toStatus ? ` → ${esc.toStatus}` : ""}`,
      detail: esc.reason,
      actor: esc.escalatedBy,
      meta: {
        fromStatus: esc.fromStatus,
        toStatus: esc.toStatus,
        fromPriority: esc.fromPriority,
        toPriority: esc.toPriority,
        fromAssignee: esc.fromAssignee,
        toAssignee: esc.toAssignee,
      },
    });
  }

  for (const c of ticket.comments) {
    events.push({
      id: `comment-${c.id}`,
      at: c.createdAt.toISOString(),
      type: "ticket.comment",
      title: "Comment",
      detail: c.body,
      actor: actorName(c.author),
    });
  }

  if (ticket.closedAt) {
    events.push({
      id: `ticket-closed-${ticket.id}`,
      at: ticket.closedAt.toISOString(),
      type: "ticket.closed",
      title: "Ticket closed",
      actor: actorName(ticket.assignee) ?? actorName(ticket.creator),
    });
  }

  let relatedServer: { id: string; name: string; host: string } | null = null;
  if (ticket.relatedServerId) {
    const server = session
      ? await prisma.server.findFirst({
          where: { id: ticket.relatedServerId, ...teamWhere(session) },
          select: { id: true, name: true, host: true },
        })
      : await prisma.server.findUnique({
          where: { id: ticket.relatedServerId },
          select: { id: true, name: true, host: true },
        });
    if (server) relatedServer = server;
  }

  let relatedCommand: {
    id: string;
    title: string;
    command: string;
    status: string;
    createdAt: string;
  } | null = null;

  if (ticket.relatedCommandId) {
    const cmd = session
      ? await prisma.commandRequest.findFirst({
          where: { id: ticket.relatedCommandId, ...teamWhere(session) },
          include: {
            requester: { select: { username: true, displayName: true } },
            approvals: {
              include: { approver: { select: { username: true, displayName: true } } },
              orderBy: { createdAt: "asc" },
            },
            executionLogs: { orderBy: { createdAt: "asc" }, take: 50 },
            targets: {
              include: { server: { select: { id: true, name: true, host: true } } },
              orderBy: { startedAt: "asc" },
            },
          },
        })
      : await prisma.commandRequest.findUnique({
          where: { id: ticket.relatedCommandId },
          include: {
            requester: { select: { username: true, displayName: true } },
            approvals: {
              include: { approver: { select: { username: true, displayName: true } } },
              orderBy: { createdAt: "asc" },
            },
            executionLogs: { orderBy: { createdAt: "asc" }, take: 50 },
            targets: {
              include: { server: { select: { id: true, name: true, host: true } } },
              orderBy: { startedAt: "asc" },
            },
          },
        });

    if (cmd) {
      relatedCommand = {
        id: cmd.id,
        title: cmd.title,
        command: cmd.command,
        status: cmd.status,
        createdAt: cmd.createdAt.toISOString(),
      };

      events.push({
        id: `cmd-created-${cmd.id}`,
        at: cmd.createdAt.toISOString(),
        type: "command.created",
        title: `Command request: ${cmd.title}`,
        detail: cmd.command,
        actor: actorName(cmd.requester),
        meta: { commandRequestId: cmd.id, status: cmd.status },
      });

      for (const approval of cmd.approvals) {
        events.push({
          id: `cmd-approval-${approval.id}`,
          at: approval.createdAt.toISOString(),
          type: "command.approval",
          title: approval.approved ? "Command approved" : "Command rejected",
          detail: approval.comment,
          actor: actorName(approval.approver),
          meta: {
            commandRequestId: cmd.id,
            approved: approval.approved,
          },
        });
      }

      for (const log of cmd.executionLogs) {
        events.push({
          id: `cmd-log-${log.id}`,
          at: log.createdAt.toISOString(),
          type: "command.execution",
          title: "Execution log",
          detail: log.summary,
          meta: { commandRequestId: cmd.id, serverId: log.serverId },
        });
      }

      for (const target of cmd.targets) {
        const at =
          target.finishedAt ?? target.startedAt ?? cmd.updatedAt ?? cmd.createdAt;
        events.push({
          id: `cmd-target-${target.id}`,
          at: at.toISOString(),
          type: "command.target",
          title: `Target ${target.server?.name ?? target.serverId}: ${target.status}`,
          detail:
            target.exitCode != null
              ? `exit=${target.exitCode}${target.stderr ? ` · ${target.stderr.slice(0, 200)}` : ""}`
              : target.stdout?.slice(0, 200) ?? null,
          meta: {
            commandRequestId: cmd.id,
            serverId: target.serverId,
            status: target.status,
            exitCode: target.exitCode,
          },
        });
      }

      events.push({
        id: `cmd-status-${cmd.id}`,
        at: cmd.updatedAt.toISOString(),
        type: "command.status",
        title: `Command status: ${cmd.status}`,
        meta: { commandRequestId: cmd.id, status: cmd.status },
      });
    }
  }

  // Reverse: other tickets that share this command (or tickets linked from same server for context)
  const reverseTickets = ticket.relatedCommandId
    ? await prisma.ticket.findMany({
        where: {
          relatedCommandId: ticket.relatedCommandId,
          NOT: { id: ticket.id },
          ...teamFilter,
        },
        select: { id: true, title: true, status: true },
        take: 20,
        orderBy: { updatedAt: "desc" },
      })
    : [];

  events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    ticketId: ticket.id,
    events,
    related: {
      server: relatedServer,
      command: relatedCommand,
      reverseTickets,
    },
  };
}

/** Tickets linked to a command request (reverse direction). */
export async function listTicketsForCommand(
  commandRequestId: string,
  session?: TeamSession | null,
) {
  const teamFilter = ticketTeamFilter(session);
  return prisma.ticket.findMany({
    where: { relatedCommandId: commandRequestId, ...teamFilter },
    select: {
      id: true,
      title: true,
      status: true,
      priority: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
}
