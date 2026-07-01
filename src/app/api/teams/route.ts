import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createTeamSchema } from "@/lib/team/schema";
import { createTeam, listTeamsForSession } from "@/lib/team/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(request, { requireAuth: true }, async ({ session }) => {
		const result = await listTeamsForSession(session!);
		return NextResponse.json(result);
	});
}

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{ permission: "team:create", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: createTeamSchema, errorMessage: "创建团队空间失败" },
		async ({ session, body }) => {
			const team = await createTeam(body, session!);
			return NextResponse.json({ success: true, team });
		},
	);
}
