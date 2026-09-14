import { apiCopy } from "@/lib/i18n/api-copy";
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
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
	const { id } = await context.params;
	return withApiRoute(
		request,
		{
			permission: "cost:read",
			rateLimit: GENERAL_READ_LIMIT,
			errorStatus: 500,
			errorMessage: apiCopy("apiCopy.failed.to.load.cloud.billing.account.5c00eddf"),
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
			errorMessage: apiCopy("apiCopy.failed.to.update.cloud.billing.account.2707ee43"),
		},
		async ({ session, body }) => {
			const account = await updateCloudBillingAccount(id, body, session ?? undefined);
			await auditUserAction(session?.userId ?? "anonymous", "cost.billing_account.update", {
				accountId: account.id,
				provider: account.provider,
				teamId: account.teamId,
			}, undefined, session?.currentTeamId);
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
			errorMessage: apiCopy("apiCopy.failed.to.delete.cloud.billing.account.7c0c6fa6"),
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
