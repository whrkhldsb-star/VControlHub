/**
 * GET /api/admin/qa-reports
 *
 * TR-029: returns the aggregated QA report list assembled by
 * `listQaReports()` from `.hermes/remediation-state.json` and
 * `.hermes/qa-loop-state.json`. The handler is read-only and shares
 * the existing admin permission gate (`task:read`) used by
 * `/api/admin/workers` so an admin role can see the same data from
 * the SPA or from `curl` for ops debugging.
 *
 * The endpoint is cheap — it reads at most two JSON files — so it
 * is rate-limited under the "admin-stats" preset (5 req/sec) rather
 * than a strict 1 req/sec.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { listQaReports } from "@/lib/qa-reports/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "task:read", errorMessage: "获取 QA 报告列表失败" },
    async () => {
      const result = await listQaReports();
      return NextResponse.json(result, { status: 200 });
    },
  );
}
