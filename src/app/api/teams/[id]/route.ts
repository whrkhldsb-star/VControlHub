import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { updateTeamSchema } from "@/lib/team/schema";
import { updateTeam, deleteTeam } from "@/lib/team/service";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(
		request,
		// Gate on the session only: updateTeam()/deleteTeam() authorize per workspace
		// (global team:manage, or owner/admin of THIS team). Requiring team:manage
		// here would lock a workspace owner out of the workspace they created.
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: updateTeamSchema, errorMessage: apiCopy("apiCopy.failed.to.update.team.fe685a88") },
		async ({ session, body }) => {
			const { id } = await params;
			const team = await updateTeam(id, body, session);
			// Audit is recorded inside updateTeam (includes fields + slug).
			return NextResponse.json({ success: true, team });
		},
	);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(
		request,
		// See PATCH: deleteTeam() itself requires global team:manage or team owner.
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, errorMessage: apiCopy("apiCopy.failed.to.delete.team.1e03bcc2") },
		async ({ session }) => {
			const { id } = await params;
			await deleteTeam(id, session);
			// Audit is recorded inside deleteTeam (includes slug/name).
			return NextResponse.json({ success: true });
		},
	);
}
