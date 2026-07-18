import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { auditUserAction } from "@/lib/audit/service";
import { checkBudgetAlerts } from "@/lib/cost/service";

export async function POST(request: Request) {
  return withApiRoute(request, { permission: "cost:manage", rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
    // Pass session so team-scoped cost:manage only evaluates their budgets,
    // not the entire fleet (and so usage aggregates use teamWhere).
    const result = await checkBudgetAlerts(new Date(), session);
    await auditUserAction(session!.userId, "cost.budget.check", { checked: result.checked, triggered: result.triggered, notificationsSent: result.notificationsSent }, undefined, session?.currentTeamId);
    return NextResponse.json({ result });
  });
}
