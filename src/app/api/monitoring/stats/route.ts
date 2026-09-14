import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { collectMonitoringStats } from "@/lib/monitoring/collector";

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{ permission: "health:read", errorMessage: apiCopy("apiCopy.failed.to.fetch.monitoring.data.5627c156") },
		async () => NextResponse.json(collectMonitoringStats()),
	);
}
