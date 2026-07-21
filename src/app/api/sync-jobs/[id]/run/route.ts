/**
 * POST /api/sync-jobs/[id]/run — execute one sync job now
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { BusinessError, NotFoundError } from "@/lib/errors";
import { getServerLocale, t } from "@/lib/i18n/translations";
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
      errorMessage: t("api.syncJobRunFailed", "zh"),
    },
    async ({ session }) => {
      const locale = await getServerLocale();
      const job = await getSyncJob(id, session ?? undefined);
      if (!job) throw new NotFoundError(t("api.syncJobNotFound", locale));
      const result = await executeSyncJob(id);
      const updated = await getSyncJob(id, session ?? undefined);
      await auditUserAction(session?.userId ?? "anonymous", "sync_job.run", {
        jobId: id,
        syncType: job.syncType,
        status: updated?.status ?? result.status ?? null,
        lastSyncResult: updated?.lastSyncResult ?? result.lastSyncResult ?? null,
        ok: result.ok,
      }, undefined, session?.currentTeamId);
      if (!result.ok) {
        // Persist ERROR/FAILED already happened; surface honest failure to client
        // instead of success:true with status=ERROR (false success UX).
        throw new BusinessError(
          result.errorMessage?.slice(0, 300) || t("api.syncJobRunFailed", locale),
          { jobId: id, status: result.status, lastSyncResult: result.lastSyncResult },
        );
      }
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
