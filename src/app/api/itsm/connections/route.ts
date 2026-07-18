/**
 * GET  /api/itsm/connections — list ITSM/IM connections (ticket:manage)
 * POST /api/itsm/connections — create connection (ticket:manage)
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createItsmConnectionSchema } from "@/lib/itsm/schema";
import { createItsmConnection, listItsmConnections } from "@/lib/itsm/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ticket:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: "Failed to list ITSM connections",
		},
		async ({ session }) => {
			const connections = await listItsmConnections(session ?? undefined);
			return NextResponse.json({ connections });
		},
	);
}

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ticket:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: createItsmConnectionSchema,
			errorStatus: 400,
			errorMessage: "Failed to create ITSM connection",
		},
		async ({ session, body }) => {
			const connection = await createItsmConnection(body, session ?? undefined);
			await auditUserAction(session?.userId ?? "anonymous", "itsm.connection.create", {
				connectionId: connection.id,
				provider: connection.provider,
				name: connection.name,
			}, undefined, session?.currentTeamId);
			return NextResponse.json({ connection }, { status: 201 });
		},
	);
}
