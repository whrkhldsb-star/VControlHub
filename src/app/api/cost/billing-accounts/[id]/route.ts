/**
 * GET    /api/cost/billing-accounts/[id]
 * PATCH  /api/cost/billing-accounts/[id]
 * DELETE /api/cost/billing-accounts/[id]
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import {
	deleteCloudBillingAccount,
	getCloudBillingAccount,
	updateCloudBillingAccount,
} from "@/lib/cost/cloud-billing/service";
import { updateCloudBillingAccountSchema } from "@/lib/cost/cloud-billing/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
	const { id } = await context.params;
	return withApiRoute(
		request,
		{
			permission: "cost:read",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: "Failed to load cloud billing account",
		},
		async ({ session }) => {
			const account = await getCloudBillingAccount(id, session ?? undefined);
			return NextResponse.json({ account });
		},
	);
}

export async function PATCH(request: Request, context: RouteContext) {
	const { id } = await context.params;
	return withApiRoute(
		request,
		{
			permission: "cost:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: updateCloudBillingAccountSchema,
			errorStatus: 400,
			errorMessage: "Failed to update cloud billing account",
		},
		async ({ session, body }) => {
			const account = await updateCloudBillingAccount(id, body, session ?? undefined);
			await auditUserAction(session?.userId ?? "anonymous", "cost.billing_account.update", {
				accountId: account.id,
				provider: account.provider,
				teamId: account.teamId,
			});
			return NextResponse.json({ account });
		},
	);
}

export async function DELETE(request: Request, context: RouteContext) {
	const { id } = await context.params;
	return withApiRoute(
		request,
		{
			permission: "cost:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 400,
			errorMessage: "Failed to delete cloud billing account",
		},
		async ({ session }) => {
			await deleteCloudBillingAccount(id, session ?? undefined);
			await auditUserAction(session?.userId ?? "anonymous", "cost.billing_account.delete", {
				accountId: id,
			}, undefined, session?.currentTeamId);
			return NextResponse.json({ ok: true });
		},
	);
}
