import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { setTeamMemberSchema } from "@/lib/team/schema";
import { listCustomerMembers, setCustomerMembership } from "@/lib/team/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(request, { permission: "team:manage" }, async ({ session }) => {
		const { id } = await params;
		return NextResponse.json({ members: await listCustomerMembers(id, session) });
	});
}

/** Put an account into this customer (moving it from any other customer). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: setTeamMemberSchema, errorMessage: apiCopy("apiCopy.failed.to.add.team.member.75d0df98") },
		async ({ session, body }) => {
			const { id } = await params;
			return NextResponse.json({ success: true, member: await setCustomerMembership({ teamId: id, ...body }, session) });
		},
	);
}
