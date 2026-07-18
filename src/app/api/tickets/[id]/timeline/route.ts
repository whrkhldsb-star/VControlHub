/**
 * GET  /api/tickets/[id]/timeline — unified ticket ↔ command timeline
 * POST /api/tickets/[id]/timeline — link/unlink command or server
 *      { action: "link_command"|"unlink_command"|"link_server"|"unlink_server", commandRequestId?, serverId? }
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";
import { auditUserAction } from "@/lib/audit/service";
import { ForbiddenError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { canViewTicket, getTicketById } from "@/lib/ticket/service";
import {
  getTicketTimeline,
  linkTicketCommand,
  linkTicketServer,
} from "@/lib/ticket/timeline";

const postSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("link_command"),
    commandRequestId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("unlink_command"),
  }),
  z.object({
    action: z.literal("link_server"),
    serverId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("unlink_server"),
  }),
]);

async function assertCanAccess(ticketId: string, session: SessionPayload) {
  // Team-scoped existence first — ticket:manage is not a cross-tenant superpower.
  const ticket = await getTicketById(ticketId, session);
  if (!ticket) throw new ForbiddenError("You cannot access this ticket");
  const canManage = sessionHasPermission(session, "ticket:manage");
  if (!canManage && !(await canViewTicket(ticketId, session.userId, session))) {
    throw new ForbiddenError("You cannot access this ticket");
  }
  return canManage;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "ticket:read",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: "Failed to load ticket timeline",
    },
    async ({ session }) => {
      const { id } = await context.params;
      await assertCanAccess(id, session!);
      const timeline = await getTicketTimeline(id, session!);
      return NextResponse.json(timeline);
    },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "ticket:manage",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: postSchema,
      errorMessage: "Failed to update ticket links",
    },
    async ({ session, body }) => {
      const { id } = await context.params;
      await assertCanAccess(id, session!);

      if (body.action === "link_command") {
        await linkTicketCommand({
          ticketId: id,
          commandRequestId: body.commandRequestId,
          actorId: session!.userId,
          session: session!,
        });
        await auditUserAction(session!.userId, "ticket.link_command", {
          ticketId: id,
          commandRequestId: body.commandRequestId,
        }, undefined, session?.currentTeamId);
      } else if (body.action === "unlink_command") {
        await linkTicketCommand({
          ticketId: id,
          commandRequestId: null,
          actorId: session!.userId,
          session: session!,
        });
        await auditUserAction(session!.userId, "ticket.unlink_command", {
          ticketId: id,
        }, undefined, session?.currentTeamId);
      } else if (body.action === "link_server") {
        await linkTicketServer({
          ticketId: id,
          serverId: body.serverId,
          actorId: session!.userId,
          session: session!,
        });
        await auditUserAction(session!.userId, "ticket.link_server", {
          ticketId: id,
          serverId: body.serverId,
        }, undefined, session?.currentTeamId);
      } else {
        await linkTicketServer({
          ticketId: id,
          serverId: null,
          actorId: session!.userId,
          session: session!,
        });
        await auditUserAction(session!.userId, "ticket.unlink_server", {
          ticketId: id,
        }, undefined, session?.currentTeamId);
      }

      const timeline = await getTicketTimeline(id, session!);
      return NextResponse.json(timeline);
    },
  );
}
