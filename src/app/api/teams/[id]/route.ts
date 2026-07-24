import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { updateTeamSchema } from "@/lib/team/schema";
import { updateTeam, deleteTeam } from "@/lib/team/service";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: updateTeamSchema, errorMessage: "Failed to update team" },
		async ({ session, body }) => {
			const { id } = await params;
			const team = await updateTeam(id, body, session!);
			// Audit is recorded inside updateTeam (includes fields + slug).
			return NextResponse.json({ success: true, team });
		},
	);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "Failed to delete team" },
		async ({ session }) => {
			const { id } = await params;
			await deleteTeam(id, session!);
			// Audit is recorded inside deleteTeam (includes slug/name).
			return NextResponse.json({ success: true });
		},
	);
}
