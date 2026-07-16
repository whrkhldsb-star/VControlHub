/**
 * DELETE /api/sync-jobs/[id] — delete team-scoped sync job
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { deleteSyncJob } from "@/lib/sync/service-crud";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Failed to delete sync job",
    },
    async ({ session }) => {
      await deleteSyncJob(id, session ?? undefined);
      await auditUserAction(session?.userId ?? "anonymous", "sync_job.delete", {
        jobId: id,
      });
      return NextResponse.json({ success: true });
    },
  );
}
