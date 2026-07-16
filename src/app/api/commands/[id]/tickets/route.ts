/**
 * GET /api/commands/[id]/tickets — reverse: tickets linked to a command request
 */
import { NextResponse } from "next/server";

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
      errorMessage: "Failed to list linked tickets",
    },
    async () => {
      const { id } = await context.params;
      const tickets = await listTicketsForCommand(id);
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
