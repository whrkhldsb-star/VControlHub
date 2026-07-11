import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { removeTeamMember } from "@/lib/team/service";
import { auditUserAction } from "@/lib/audit/service";

export const dynamic = "force-dynamic";

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string; userId: string }> },
) {
	return withApiRoute(
		request,
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "Failed to remove team member" },
		async ({ session }) => {
			const { id, userId } = await params;
			await removeTeamMember(id, userId, session!);
			await auditUserAction(session!.userId, "team.member.remove", { teamId: id, userId });
   return NextResponse.json({ success: true });
		},
	);
}
