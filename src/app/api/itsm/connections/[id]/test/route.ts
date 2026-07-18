/**
 * POST /api/itsm/connections/[id]/test — outbound connectivity probe
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { testItsmConnection } from "@/lib/itsm/service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

const bodySchema = z
	.object({
		message: z.string().trim().max(500).optional(),
	})
	.strict()
	.optional()
	.default({});

export async function POST(request: Request, context: RouteContext) {
	const { id } = await context.params;
	return withApiRoute(
		request,
		{
			permission: "ticket:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema,
			errorStatus: 400,
			errorMessage: "Failed to test ITSM connection",
		},
		async ({ session, body }) => {
			const result = await testItsmConnection(id, body?.message, session ?? undefined);
			await auditUserAction(session?.userId ?? "anonymous", "itsm.connection.test", {
				connectionId: id,
				ok: result.ok,
			}, undefined, session?.currentTeamId);
			return NextResponse.json(result, { status: result.ok ? 200 : 502 });
		},
	);
}
