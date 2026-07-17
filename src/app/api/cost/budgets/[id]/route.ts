import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { auditUserAction } from "@/lib/audit/service";
import { updateCostBudget, deleteCostBudget } from "@/lib/cost/service";
import { updateCostBudgetSchema } from "@/lib/cost/schema";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "cost:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: updateCostBudgetSchema }, async ({ session, body }) => {
    const { id } = await params;
    const budget = await updateCostBudget(id, body, session);
    await auditUserAction(session!.userId, "cost.budget.update", { budgetId: id });
    return NextResponse.json({ budget });
  });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "cost:manage", rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
    const { id } = await params;
    await deleteCostBudget(id, session);
    await auditUserAction(session!.userId, "cost.budget.delete", { budgetId: id }, "WARNING");
    return NextResponse.json({ success: true });
  });
}
