/**
 * GET /api/admin/workers
 *
 * Health check for the standalone worker fleet. Runtime heartbeats are
 * persisted so the web process can report the state of another process.
 *
 * TR-001 T13c: this endpoint is the read-only companion to
 * `@/lib/workers/registry`. It does not start or stop anything.
 *
 * Auth: `task:read`, and the platform role, like the system self-check
 * (/api/system-health): the fleet, its instances and their last errors are
 * the platform's, not a customer's, and task:read is part of every customer
 * identity template. The endpoint performs one small indexed database read.
 */
import { NextResponse } from "next/server";

import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { withApiRoute } from "@/lib/http/api-guard";
import { getWorkerRuntimeHealth } from "@/lib/workers/runtime-health";
import { getServerLocale, t } from "@/lib/i18n/translations";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "task:read", errorMessage: t("api.admin.workers.fetchFailed", locale) },
    async ({ session }) => {
      assertPlatformAdmin(session);
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
