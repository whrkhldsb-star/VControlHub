import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { withApiRoute } from "@/lib/http/api-guard";
import { collectMonitoringStats } from "@/lib/monitoring/collector";

/** Hub host resources: platform administrators only. */
export async function GET(request: Request) {
	return withApiRoute(
		request,
		{ permission: "health:read", errorMessage: apiCopy("apiCopy.failed.to.fetch.monitoring.data.5627c156") },
		async ({ session }) => {
			assertPlatformAdmin(session);
			return NextResponse.json(await collectMonitoringStats());
		},
	);
}
