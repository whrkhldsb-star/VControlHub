/**
 * POST /api/cost/billing-accounts/[id]/sync
 * Body: { month?: "YYYY-MM" }
 * Permission: cost:manage
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { syncCloudBillingAccount } from "@/lib/cost/cloud-billing/service";
import { syncCloudBillingSchema } from "@/lib/cost/cloud-billing/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext) {
	const { id } = await context.params;
	return withApiRoute(
		request,
		{
			permission: "cost:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: syncCloudBillingSchema,
			errorStatus: 400,
			errorMessage: "Failed to sync cloud billing account",
		},
		async ({ session, body }) => {
			const result = await syncCloudBillingAccount(id, body.month);
			await auditUserAction(session?.userId ?? "anonymous", "cost.billing_account.sync", {
				accountId: id,
				month: result.run.month,
				imported: result.imported,
				skipped: result.skipped,
				status: result.run.status,
			});
			return NextResponse.json({ result });
		},
	);
}
