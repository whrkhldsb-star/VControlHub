import { NextResponse } from "next/server";

import { getJobBacklogMetrics } from "@/lib/job/metrics";
import { withApiRoute } from "@/lib/http/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "audit:read" }, async () => {
    const metrics = await getJobBacklogMetrics();
    return NextResponse.json({ metrics });
  });
}
