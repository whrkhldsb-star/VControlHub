import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * TR-031 E01: /api/cost/entries/[id] — get / update / delete a single entry.
 *
 * GET    → { entry: CostEntryRecord | null }   (cost:read)
 * PATCH  → { entry: CostEntryRecord }          (cost:manage)
 * DELETE → { success: true }                   (cost:manage)
 *
 * The id is a cuid string. We rely on the Prisma unique constraint to
 * 404 on missing rows.
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import {
	deleteCostEntry,
	getCostEntry,
	updateCostEntry,
} from "@/lib/cost/service";
import { updateCostEntrySchema } from "@/lib/cost/schema";
import { NotFoundError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export async function GET(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	return withApiRoute(
		request,
		{
			permission: "cost:read",
			rateLimit: GENERAL_READ_LIMIT,
			errorStatus: 500,
			errorMessage: apiCopy("apiCopy.failed.to.load.cost.entry.313305bd"),
		},
		async ({ session }) => {
			const entry = await getCostEntry(id, session);
			if (!entry) {
				throw new NotFoundError(apiCopy("apiCopy.cost.entry.not.found.ab85a464", { v0: String(id) }));
			}
			return NextResponse.json({ entry });
		},
	);
}

export async function PATCH(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	return withApiRoute(
		request,
		{
			permission: "cost:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: updateCostEntrySchema,
			errorStatus: 400,
			errorMessage: apiCopy("apiCopy.failed.to.update.cost.entry.c0d4adea"),
		},
		async ({ session, body }) => {
			const entry = await updateCostEntry(id, body, session);
			await auditUserAction(session.userId, "cost.update", {
				entryId: entry.id,
				updatedFields: Object.keys(body),
			}, undefined, session.currentTeamId);
			return NextResponse.json({ entry });
		},
	);
}

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string }> },
) {
	const { id } = await params;
	return withApiRoute(
		request,
		{
			permission: "cost:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 400,
			errorMessage: apiCopy("apiCopy.failed.to.delete.cost.entry.bfd4ca79"),
		},
		async ({ session }) => {
			await deleteCostEntry(id, session);
			await auditUserAction(session.userId, "cost.delete", {
				entryId: id,
			}, undefined, session.currentTeamId);
			return NextResponse.json({ success: true });
		},
	);
}
