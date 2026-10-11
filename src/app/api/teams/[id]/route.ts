import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { updateTeamSchema } from "@/lib/team/schema";
import { updateTeam, deleteTeam } from "@/lib/team/service";
import { teamSessionResponse } from "@/lib/auth/team-session-response";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: updateTeamSchema, errorMessage: apiCopy("apiCopy.failed.to.update.team.fe685a88") },
		async ({ session, body }) => {
			const { id } = await params;
			return NextResponse.json({ success: true, team: await updateTeam(id, body, session) });
		},
	);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: apiCopy("apiCopy.failed.to.delete.team.1e03bcc2") },
		async ({ session }) => {
			const { id } = await params;
			const result = await deleteTeam(id, session);
			return teamSessionResponse(request, result.nextCurrentTeamId, { success: true });
		},
	);
}
