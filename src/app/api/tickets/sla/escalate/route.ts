/**
 * FEAT-P1-1: Manual SLA escalation trigger.
 * POST /api/tickets/sla/escalate
 */
import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { escalateBreachedTickets } from "@/lib/ticket/sla";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiRoute(request, { permission: "ticket:manage" }, async ({ session }) => {
    const escalatedCount = await escalateBreachedTickets();
    await auditUserAction(session?.userId ?? "", "ticket.sla_escalate", { escalatedCount });
    return NextResponse.json({ escalated: escalatedCount });
  });
}
