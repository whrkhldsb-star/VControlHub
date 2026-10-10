import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { transferServerToCustomer } from "@/lib/server/transfer";

export const dynamic = "force-dynamic";

const transferServerSchema = z.object({ teamId: z.string().trim().min(1).max(64) });

/** Move a server, with its storage and history, to another customer. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
	return withApiRoute(
		request,
		{ permission: "team:manage", rateLimit: GENERAL_WRITE_LIMIT, bodySchema: transferServerSchema },
		async ({ session, body }) => {
			const { id } = await params;
			return NextResponse.json({ success: true, ...(await transferServerToCustomer(id, body.teamId, session)) });
		},
	);
}
