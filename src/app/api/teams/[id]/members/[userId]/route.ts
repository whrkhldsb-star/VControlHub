import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { updateTeamMemberSchema } from "@/lib/team/schema";
import { removeTeamMember, setCustomerMembership } from "@/lib/team/service";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; userId: string }> };

/** Change the member's identity template. */
export async function PATCH(request: Request, { params }: Params) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: updateTeamMemberSchema },
		async ({ session, body }) => {
			const { id, userId } = await params;
			return NextResponse.json({ success: true, member: await setCustomerMembership({ teamId: id, userId, identityTemplateId: body.identityTemplateId }, session) });
		},
	);
}

export async function DELETE(request: Request, { params }: Params) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: apiCopy("apiCopy.failed.to.remove.team.member.8a8fc863") },
		async ({ session }) => {
			const { id, userId } = await params;
			await removeTeamMember(id, userId, session);
			return NextResponse.json({ success: true });
		},
	);
}
