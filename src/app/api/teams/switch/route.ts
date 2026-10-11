import { apiCopy } from "@/lib/i18n/api-copy";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { switchTeamSchema } from "@/lib/team/schema";
import { switchCurrentTeam } from "@/lib/team/service";
import { teamSessionResponse } from "@/lib/auth/team-session-response";

export const dynamic = "force-dynamic";

/** Administrators select a customer to work in, or `null` for all customers. */
export async function POST(request: Request) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: switchTeamSchema, errorMessage: apiCopy("apiCopy.failed.to.switch.team.workspace.72eeb9fa") },
		async ({ session, body }) => {
			const team = await switchCurrentTeam(body.teamId, session);
			return teamSessionResponse(request, team?.id ?? null, { success: true, team });
		},
	);
}
