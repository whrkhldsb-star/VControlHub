import { NextResponse } from "next/server";

import { getJobBacklogMetrics } from "@/lib/job/metrics";
import { withApiRoute } from "@/lib/http/api-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "audit:read" }, async ({ session }) => {
    // Scope metrics to the caller's team (admins still see all via teamWhere).
    const metrics = await getJobBacklogMetrics(session);
    return NextResponse.json({ metrics });
  });
}
