import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { addTeamMemberSchema } from "@/lib/team/schema";
import { addTeamMember } from "@/lib/team/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(
		request,
		{ requireAuth: true, rateLimit: GENERAL_WRITE_LIMIT, bodySchema: addTeamMemberSchema, errorMessage: "Failed to add team member" },
		async ({ session, body }) => {
			const { id } = await params;
			const member = await addTeamMember(id, body, session!);
			return NextResponse.json({ success: true, member });
		},
	);
}
