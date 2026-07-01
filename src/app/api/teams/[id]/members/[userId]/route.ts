import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { removeTeamMember } from "@/lib/team/service";

export const dynamic = "force-dynamic";

export async function DELETE(
	request: Request,
	{ params }: { params: Promise<{ id: string; userId: string }> },
) {
	return withApiRoute(
		request,
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "移除团队成员失败" },
		async ({ session }) => {
			const { id, userId } = await params;
			await removeTeamMember(id, userId, session!);
			return NextResponse.json({ success: true });
		},
	);
}
