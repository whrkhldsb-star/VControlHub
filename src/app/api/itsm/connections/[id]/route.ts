/**
 * GET/PATCH/DELETE /api/itsm/connections/[id]
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
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
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: "Failed to load ITSM connection",
		},
		async () => {
			const connection = await getItsmConnection(id);
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
			errorMessage: "Failed to update ITSM connection",
		},
		async ({ session, body }) => {
			const connection = await updateItsmConnection(id, body);
			await auditUserAction(session?.userId ?? "anonymous", "itsm.connection.update", {
				connectionId: connection.id,
				provider: connection.provider,
			});
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
			errorMessage: "Failed to delete ITSM connection",
		},
		async ({ session }) => {
			await deleteItsmConnection(id);
			await auditUserAction(session?.userId ?? "anonymous", "itsm.connection.delete", {
				connectionId: id,
			});
			return NextResponse.json({ ok: true });
		},
	);
}
