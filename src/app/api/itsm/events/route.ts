/**
 * GET /api/itsm/events — recent ITSM event log (ticket:manage)
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { listItsmEvents } from "@/lib/itsm/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ticket:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: "Failed to list ITSM events",
		},
		async () => {
			const url = new URL(request.url);
			const connectionId = url.searchParams.get("connectionId") ?? undefined;
			const ticketId = url.searchParams.get("ticketId") ?? undefined;
			const limit = Number(url.searchParams.get("limit") ?? "50");
			const events = await listItsmEvents({
				connectionId,
				ticketId,
				limit: Number.isFinite(limit) ? limit : 50,
			});
			return NextResponse.json({ events });
		},
	);
}
