/**
 * GET  /api/cost/billing-accounts — list cloud billing accounts (cost:read)
 * POST /api/cost/billing-accounts — create account (cost:manage)
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import {
	createCloudBillingAccount,
	listCloudBillingAccounts,
} from "@/lib/cost/cloud-billing/service";
import { createCloudBillingAccountSchema } from "@/lib/cost/cloud-billing/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "cost:read",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: "Failed to list cloud billing accounts",
		},
		async () => {
			const accounts = await listCloudBillingAccounts();
			return NextResponse.json({ accounts });
		},
	);
}

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "cost:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: createCloudBillingAccountSchema,
			errorStatus: 400,
			errorMessage: "Failed to create cloud billing account",
		},
		async ({ session, body }) => {
			const createdById = session?.userId ?? null;
			const account = await createCloudBillingAccount(body, createdById);
			await auditUserAction(createdById ?? "anonymous", "cost.billing_account.create", {
				accountId: account.id,
				provider: account.provider,
				name: account.name,
			});
			return NextResponse.json({ account }, { status: 201 });
		},
	);
}
