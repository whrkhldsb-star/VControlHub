import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createTeamSchema } from "@/lib/team/schema";
import { createTeam, listTeamsForSession } from "@/lib/team/service";

export const dynamic = "force-dynamic";

/** Administrators: all customers; customer accounts: their own customer. */
export async function GET(request: Request) {
	return withApiRoute(request, { permission: "team:read" }, async ({ session }) => {
		return NextResponse.json(await listTeamsForSession(session));
	});
}

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: createTeamSchema, errorMessage: apiCopy("apiCopy.failed.to.create.team.workspace.cbc63c23") },
		async ({ session, body }) => NextResponse.json({ success: true, team: await createTeam(body, session) }),
	);
}
