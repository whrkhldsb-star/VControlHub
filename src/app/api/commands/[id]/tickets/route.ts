import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * GET /api/commands/[id]/tickets — reverse: tickets linked to a command request
 */
import { NextResponse } from "next/server";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { ForbiddenError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { listTicketsForCommand } from "@/lib/ticket/timeline";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "command:read",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: apiCopy("apiCopy.failed.to.list.linked.tickets.a09460bc"),
    },
    async ({ session }) => {
      // Ticket titles are the tickets' own business: the list needs the permission to read tickets, not only commands.
      if (!sessionHasPermission(session, "ticket:read")) {
        throw new ForbiddenError(apiCopy("apiCopy.insufficient.permissions.37e6815b"));
      }
      const { id } = await context.params;
      const tickets = await listTicketsForCommand(id, session);
      return NextResponse.json({
        commandRequestId: id,
        tickets: tickets.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          updatedAt: t.updatedAt.toISOString(),
        })),
      });
    },
  );
}
