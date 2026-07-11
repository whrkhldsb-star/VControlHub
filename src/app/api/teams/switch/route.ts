import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { switchTeamSchema } from "@/lib/team/schema";
import { switchCurrentTeam } from "@/lib/team/service";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: switchTeamSchema, errorMessage: "Failed to switch team workspace" },
		async ({ session, body }) => {
			const team = await switchCurrentTeam(body.teamId, session!);
			await auditUserAction(session?.userId ?? "", "team.switch", { teamId: body.teamId });
   return NextResponse.json({ success: true, team });
		},
	);
}
