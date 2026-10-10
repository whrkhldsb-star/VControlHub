import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { restoreTeam } from "@/lib/team/service";

export const dynamic = "force-dynamic";

/** Bring a deleted customer, its data and its accounts back. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(request, { permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT }, async ({ session }) => {
		const { id } = await params;
		await restoreTeam(id, session);
		return NextResponse.json({ success: true });
	});
}
