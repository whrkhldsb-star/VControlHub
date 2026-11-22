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
import { canReadCommandBody } from "@/lib/command/visibility";
import type { Permission, RoleKey } from "@/lib/auth/rbac";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { Prisma } from "@prisma/client";
import { commandRequestTeamWhere, serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { lockTicket } from "./transaction";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";
import { t } from "@/lib/i18n/service-translations";

type TeamSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null; permissions?: Permission[] };

function ticketTeamFilter(session?: TeamSession | null): Record<string, unknown> {
  return session ? teamWhere(session) : {};
}

/**
 * Which tickets the caller may see besides the customer boundary: everyone's with ticket:manage, otherwise only
 * those they created or are assigned (the rule of the ticket list and of a single ticket). The reverse links used
 * the customer boundary alone, so a viewer could read other people's ticket titles through a command.
 */
function ticketParticipantFilter(session?: TeamSession | null): Record<string, unknown> {
  if (!session || sessionHasPermission(session, "ticket:manage")) return {};
  return { OR: [{ createdBy: session.userId }, { assigneeId: session.userId }] };
}

/**
 * Include shape for a related command request on the timeline (TR: used to be
 * duplicated verbatim in the team-scoped findFirst and unscoped findUnique
 * branches below — approvals, execution logs and targets all render events).
 */
const relatedCommandInclude = {
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
} satisfies Prisma.CommandRequestInclude;

/** Select shape for the optional related server card (both scoped/unscoped branches). */
const relatedServerSelect = { id: true, name: true, host: true } satisfies Prisma.ServerSelect;


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

/**
 * Human-facing actor label for timeline/audit rows (TR: operation-task used
 * to carry an identical local copy). Display name wins, username falls back,
 * null when neither exists.
 */
export function actorName(user?: { username?: string | null; displayName?: string | null } | null): string | null {
  if (!user) return null;
  return user.displayName || user.username || null;
}

type LinkInput = { ticketId: string; actorId?: string; session?: TeamSession | null };

function updateTicketLink(input: LinkInput, field: "relatedServerId" | "relatedCommandId", next: string | null) {
  return prisma.$transaction(async (tx) => {
    await lockTicket(tx, input.ticketId);
    const where = { id: input.ticketId, ...ticketTeamFilter(input.session) };
    const ticket = await tx.ticket.findUnique({ where });
    if (!ticket) throw new NotFoundError(t("backend.ticket.ticketNotFound"));
    const serverLink = field === "relatedServerId";
    if (input.session) {
      const requiredPermission = serverLink ? "server:read" : "command:read";
      if (!sessionHasPermission(input.session, requiredPermission)) {
        throw new ForbiddenError(apiCopy("apiCopy.missing.permission.db2e4ec2", { v0: requiredPermission }));
      }
    }
    if (next) {
      const target = serverLink
        ? await tx.server.findFirst({ where: { id: next, ...(input.session ? serverTeamWhere(input.session) : {}) }, select: { id: true } })
        : await tx.commandRequest.findFirst({ where: { id: next, ...(input.session ? commandRequestTeamWhere(input.session) : {}) }, select: { id: true } });
      if (!target) throw new ValidationError(serverLink ? t("backend.ticket.serverNotFound") : t("backend.command.requestNotFound"));
    }
    const previous = ticket[field];
    if (previous === next) return ticket;
    const updated = await tx.ticket.update({ where, data: { [field]: next } });
    const label = serverLink ? "server" : "command request";
    const history = [
      ...(previous ? [`Unlinked ${label} ${previous}`] : []),
      ...(next ? [`Linked ${label} ${next}`] : []),
    ];
    await tx.ticketEscalation.createMany({ data: history.map((reason) => ({
      ticketId: ticket.id, fromStatus: ticket.status, toStatus: ticket.status, reason, escalatedBy: input.actorId ?? null,
    })) });
    return updated;
  });
}

export function linkTicketCommand(input: LinkInput & { commandRequestId: string | null }) {
  return updateTicketLink(input, "relatedCommandId", input.commandRequestId);
}

export function linkTicketServer(input: LinkInput & { serverId: string | null }) {
  return updateTicketLink(input, "relatedServerId", input.serverId);
}

type TicketTimeline = {
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
};

export function getTicketTimeline(ticketId: string, session?: TeamSession | null) {
  return prisma.$transaction((tx) => readTicketTimeline(tx, ticketId, session), { isolationLevel: "RepeatableRead" });
}

async function readTicketTimeline(tx: Prisma.TransactionClient, ticketId: string, session?: TeamSession | null): Promise<TicketTimeline> {
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
    ? await tx.ticket.findFirst({
        where: { id: ticketId, AND: [teamFilter, ticketParticipantFilter(session)] },
        include: ticketInclude,
      })
    : await tx.ticket.findUnique({
        where: { id: ticketId },
        include: ticketInclude,
      });
  if (!ticket) throw new NotFoundError(t("backend.ticket.ticketNotFound"));

  // History lines store who acted by user id; show their name.
  const actorIds = [...new Set(ticket.escalations.map((esc) => esc.escalatedBy).filter((id): id is string => Boolean(id)))];
  const actors = new Map(
    actorIds.length
      ? (await tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, username: true, displayName: true } }))
          .map((user) => [user.id, actorName(user)] as const)
      : [],
  );

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

  const canReadServer = !session || sessionHasPermission(session, "server:read");
  const serverHistoryId = (reason: string | null) => /^(?:Linked|Unlinked) server (.+)$/.exec(reason ?? "")?.[1];
  const serverIds = new Set(ticket.escalations.map((row) => serverHistoryId(row.reason)).filter((id): id is string => Boolean(id)));
  if (ticket.relatedServerId) serverIds.add(ticket.relatedServerId);
  const visibleServers = canReadServer && serverIds.size
    ? await tx.server.findMany({
        where: { id: { in: [...serverIds] }, ...(session ? serverTeamWhere(session) : {}) },
        select: relatedServerSelect,
      })
    : [];
  const serversById = new Map(visibleServers.map((server) => [server.id, server]));
  const relatedServer = ticket.relatedServerId ? serversById.get(ticket.relatedServerId) ?? null : null;
  if (relatedServer) {
    events.push({
      id: `ticket-server-${ticket.id}`,
      at: ticket.createdAt.toISOString(),
      type: "ticket.linked_server",
      title: "Linked VPS",
      detail: relatedServer.id,
      meta: { serverId: relatedServer.id },
    });
  }

  const commandHistoryId = (reason: string | null) => /^(?:Linked|Unlinked) command (?:request )?(.+)$/.exec(reason ?? "")?.[1];
  const commandIds = ticket.escalations.flatMap(row => commandHistoryId(row.reason) ?? []);
  const canReadCommand = !session || sessionHasPermission(session, "command:read");
  const visibleCommands = canReadCommand && commandIds.length ? await tx.commandRequest.findMany({
    where: { id: { in: commandIds }, ...(session ? commandRequestTeamWhere(session) : {}) }, select: { id: true },
  }) : [];
  const visibleCommandIds = new Set(visibleCommands.map(command => command.id));
  for (const esc of ticket.escalations) {
    const historicalCommand = commandHistoryId(esc.reason);
    if (historicalCommand && !visibleCommandIds.has(historicalCommand)) continue;
    const historicalServer = serverHistoryId(esc.reason);
    if (historicalServer && !serversById.has(historicalServer)) continue;
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
      actor: esc.escalatedBy ? actors.get(esc.escalatedBy) ?? esc.escalatedBy : null,
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

  // Closing is in the status history now; older tickets only have closedAt.
  const closeRecorded = ticket.escalations.some((esc) => esc.toStatus === "CLOSED" && esc.fromStatus !== "CLOSED");
  if (ticket.closedAt && !closeRecorded) {
    events.push({
      id: `ticket-closed-${ticket.id}`,
      at: ticket.closedAt.toISOString(),
      type: "ticket.closed",
      title: "Ticket closed",
      actor: actorName(ticket.assignee) ?? actorName(ticket.creator),
    });
  }

  let relatedCommand: {
    id: string;
    title: string;
    command: string;
    status: string;
    createdAt: string;
  } | null = null;

  if (ticket.relatedCommandId && canReadCommand) {
    const cmd = session
      ? await tx.commandRequest.findFirst({
          // Command requests carry the command text, approvals and execution
          // logs — strict scope, so a null-team (quarantined) request is not
          // rendered into another tenant's ticket timeline.
          where: { id: ticket.relatedCommandId, ...commandRequestTeamWhere(session) },
          include: { ...relatedCommandInclude, targets: {
            ...relatedCommandInclude.targets, where: canReadServer ? { server: serverTeamWhere(session) } : { id: { in: [] } },
          } },
        })
      : await tx.commandRequest.findUnique({
          where: { id: ticket.relatedCommandId },
          include: relatedCommandInclude,
        });

    if (cmd) {
      const showBody = !session || canReadCommandBody(session.userId, cmd.requesterId, sessionHasPermission(session, "command:approve"));
      relatedCommand = {
        id: cmd.id,
        title: cmd.title,
        command: showBody ? cmd.command : "",
        status: cmd.status,
        createdAt: cmd.createdAt.toISOString(),
      };

      events.push({
        id: `cmd-created-${cmd.id}`,
        at: cmd.createdAt.toISOString(),
        type: "command.created",
        title: `Command request: ${cmd.title}`,
        detail: showBody ? cmd.command : null,
        actor: actorName(cmd.requester),
        meta: { commandRequestId: cmd.id, status: cmd.status },
      });

      for (const approval of showBody ? cmd.approvals : []) {
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

      const visibleTargets = new Set(cmd.targets.map(target => target.serverId));
      for (const log of showBody ? cmd.executionLogs : []) {
        if (session && (!log.serverId || !visibleTargets.has(log.serverId))) continue;
        events.push({
          id: `cmd-log-${log.id}`,
          at: log.createdAt.toISOString(),
          type: "command.execution",
          title: "Execution log",
          detail: log.summary,
          meta: { commandRequestId: cmd.id, serverId: log.serverId },
        });
      }

      for (const target of showBody ? cmd.targets : []) {
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
  const reverseTickets = relatedCommand && ticket.relatedCommandId
    ? await tx.ticket.findMany({
        where: {
          relatedCommandId: ticket.relatedCommandId,
          NOT: { id: ticket.id },
          AND: [teamFilter, ticketParticipantFilter(session)],
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
    where: { relatedCommandId: commandRequestId, AND: [teamFilter, ticketParticipantFilter(session)] },
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
