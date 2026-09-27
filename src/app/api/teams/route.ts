import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createTeamSchema } from "@/lib/team/schema";
import { createTeam, listTeamsForSession } from "@/lib/team/service";
import { teamSessionResponse } from "@/lib/auth/team-session-response";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(request, { requireAuth: true }, async ({ session }) => {
		// Workspace enumeration is a browser control-plane action. A token bound
		// to one workspace must not list its owner's other memberships.
		if (!sessionHasPermission(session, "team:read")) {
			throw new ForbiddenError(t("backend.team.readRequired"));
		}
		const result = await listTeamsForSession(session);
		return NextResponse.json(result);
	});
}

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: createTeamSchema, errorMessage: apiCopy("apiCopy.failed.to.create.team.workspace.cbc63c23") },
		async ({ session, body }) => {
			const team = await createTeam(body, session);
			// Audit is recorded inside createTeam (richer metadata: slug/name).
			return teamSessionResponse(request, team.id, { success: true, team });
		},
	);
}
