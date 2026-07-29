/**
 * GET /api/admin/workers
 *
 * Health check for the standalone worker fleet. Runtime heartbeats are
 * persisted so the web process can report the state of another process.
 *
 * TR-001 T13c: this endpoint is the read-only companion to
 * `@/lib/workers/registry`. It does not start or stop anything.
 *
 * Auth: same as the rest of the admin routes — caller must have
 * permission `task:read` (admins + owners). The endpoint performs one
 * small indexed database read.
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { getWorkerRuntimeHealth } from "@/lib/workers/runtime-health";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "task:read", errorMessage: "Fetch worker StatusFailed" },
    async () => {
      const workers = await getWorkerRuntimeHealth();
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
