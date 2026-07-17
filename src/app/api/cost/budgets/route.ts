import { NextResponse } from "next/server";
import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createCostBudget, listCostBudgets } from "@/lib/cost/service";
import { createCostBudgetSchema } from "@/lib/cost/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(request, { permission: "cost:read", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "Failed to load cost budgets" }, async ({ session }) => {
		return NextResponse.json({ budgets: await listCostBudgets(new Date(), session) });
	});
}

export async function POST(request: Request) {
	return withApiRoute(request, { permission: "cost:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: createCostBudgetSchema, errorStatus: 400, errorMessage: "Failed to create cost budget" }, async ({ session, body }) => {
		const budget = await createCostBudget(body, session);
		await auditUserAction(session?.userId ?? "anonymous", "cost.budget.create", { budgetId: budget.id, category: budget.category, limitAmount: budget.limitAmount, currency: budget.currency });
		return NextResponse.json({ budget });
	});
}
