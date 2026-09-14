import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { switchTeamSchema } from "@/lib/team/schema";
import { switchCurrentTeam } from "@/lib/team/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: switchTeamSchema, errorMessage: apiCopy("apiCopy.failed.to.switch.team.workspace.72eeb9fa") },
		async ({ session, body }) => {
			const team = await switchCurrentTeam(body.teamId, session!);
			// Audit is recorded inside switchCurrentTeam (includes slug).
			return NextResponse.json({ success: true, team });
		},
	);
}
