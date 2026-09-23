import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * GET/PATCH/DELETE /api/itsm/connections/[id]
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { updateItsmConnectionSchema } from "@/lib/itsm/schema";
import {
	deleteItsmConnection,
	getItsmConnection,
	updateItsmConnection,
} from "@/lib/itsm/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext) {
	const { id } = await context.params;
	return withApiRoute(
		request,
		{
			permission: "ticket:manage",
			rateLimit: GENERAL_READ_LIMIT,
			errorStatus: 500,
			errorMessage: apiCopy("apiCopy.failed.to.load.itsm.connection.b7f1d4a7"),
		},
		async ({ session }) => {
			const connection = await getItsmConnection(id, session);
			return NextResponse.json({ connection });
		},
	);
}

export async function PATCH(request: Request, context: RouteContext) {
	const { id } = await context.params;
	return withApiRoute(
		request,
		{
			permission: "ticket:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: updateItsmConnectionSchema,
			errorStatus: 400,
			errorMessage: apiCopy("apiCopy.failed.to.update.itsm.connection.74ecbc74"),
		},
		async ({ session, body }) => {
			const connection = await updateItsmConnection(id, body, session);
			await auditUserAction(session.userId, "itsm.connection.update", {
				connectionId: connection.id,
				provider: connection.provider,
			}, undefined, session.currentTeamId);
			return NextResponse.json({ connection });
		},
	);
}

export async function DELETE(request: Request, context: RouteContext) {
	const { id } = await context.params;
	return withApiRoute(
		request,
		{
			permission: "ticket:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 400,
			errorMessage: apiCopy("apiCopy.failed.to.delete.itsm.connection.587ecabb"),
		},
		async ({ session }) => {
			await deleteItsmConnection(id, session);
			await auditUserAction(session.userId, "itsm.connection.delete", {
				connectionId: id,
			}, undefined, session.currentTeamId);
			return NextResponse.json({ ok: true });
		},
	);
}
