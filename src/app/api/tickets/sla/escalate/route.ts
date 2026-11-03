/**
 * FEAT-P1-1: Manual SLA escalation trigger.
 * POST /api/tickets/sla/escalate
 */
import { seesAllCustomers } from "@/lib/auth/team-scope";
import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { escalateBreachedTickets } from "@/lib/ticket/sla";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiRoute(
    request,
    { permission: "ticket:manage", rateLimit: GENERAL_WRITE_LIMIT },
    async ({ session }) => {
      // Fleet-wide for accounts that see every customer; otherwise the active
      // customer, and never the platform's team-less tickets (A8-06).
      if (!seesAllCustomers(session) && !session.currentTeamId) {
        throw new BusinessError(t("backend.ticket.escalateNeedsActiveCustomer"));
      }
      const teamId = seesAllCustomers(session) ? undefined : session.currentTeamId;
      const escalatedCount = await escalateBreachedTickets({ teamId });
      await auditUserAction(session.userId, "ticket.sla_escalate", { escalatedCount }, undefined, session.currentTeamId);
      return NextResponse.json({ escalated: escalatedCount });
    },
  );
}
