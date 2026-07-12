import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { collectMonitoringStats } from "@/lib/monitoring/collector";

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{ requireAuth: true, errorMessage: "Failed to fetch monitoring data" },
		async () => NextResponse.json(collectMonitoringStats()),
	);
}
