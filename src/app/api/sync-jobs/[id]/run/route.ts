/**
 * POST /api/sync-jobs/[id]/run — execute one sync job now
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { NotFoundError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { getSyncJob } from "@/lib/sync/service-crud";
import { executeSyncJob } from "@/lib/sync/service-runtime";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Failed to run sync job",
    },
    async ({ session }) => {
      const job = await getSyncJob(id, session ?? undefined);
      if (!job) throw new NotFoundError("Sync job not found");
      await executeSyncJob(id);
      const updated = await getSyncJob(id, session ?? undefined);
      await auditUserAction(session?.userId ?? "anonymous", "sync_job.run", {
        jobId: id,
        syncType: job.syncType,
        status: updated?.status ?? null,
        lastSyncResult: updated?.lastSyncResult ?? null,
      });
      return NextResponse.json({
        success: true,
        job: updated
          ? {
              id: updated.id,
              status: updated.status,
              lastSyncAt: updated.lastSyncAt?.toISOString() ?? null,
              lastSyncResult: updated?.lastSyncResult,
              syncType: updated.syncType,
            }
          : null,
      });
    },
  );
}
