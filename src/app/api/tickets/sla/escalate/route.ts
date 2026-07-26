/**
 * FEAT-P1-1: Manual SLA escalation trigger.
 * POST /api/tickets/sla/escalate
 */
import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { escalateBreachedTickets } from "@/lib/ticket/sla";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "ticket:manage", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      const teamId = sessionHasPermission(session!, "team:manage") ? undefined : session?.currentTeamId ?? null;
      const escalatedCount = await escalateBreachedTickets({ teamId });
      await auditUserAction(session?.userId ?? "", "ticket.sla_escalate", { escalatedCount }, undefined, session?.currentTeamId);
      return NextResponse.json({ escalated: escalatedCount });
    },
  );
}
