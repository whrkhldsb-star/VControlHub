/**
 * GET /api/admin/workers
 *
 * Health check for the in-process worker fleet. Returns each worker's
 * `started` flag (true once the interval timer is set, false otherwise)
 * plus a small summary used by dashboards and post-deploy probes.
 *
 * TR-001 T13c: this endpoint is the read-only companion to
 * `@/lib/workers/registry`. It does not start or stop anything.
 *
 * Auth: same as the rest of the admin routes — caller must have
 * permission `task:read` (admins + owners). The endpoint is cheap
 * (no I/O — purely in-memory read), so the rate-limit preset is
 * "admin-stats" (5 req/sec) instead of a hard 1 req.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { getWorkerStatuses } from "@/lib/workers/registry";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "task:read", errorMessage: "获取 worker 状态失败" },
    async () => {
      const workers = getWorkerStatuses();
      const startedCount = workers.filter((w) => w.started).length;
      const totalCount = workers.length;
      const healthy = startedCount === totalCount;
      return NextResponse.json(
        {
          healthy,
          startedCount,
          totalCount,
          workers,
        },
        { status: healthy ? 200 : 503 },
      );
    },
  );
}
