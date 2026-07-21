import { getServerLocale, t } from "@/lib/i18n/translations";
/**
 * GET /api/sync-jobs/[id]/report — last result + logs + conflict hints
 */
import { NextResponse } from "next/server";

import { NotFoundError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { buildSyncReportView } from "@/lib/sync/report";
import { getSyncJob } from "@/lib/sync/service-crud";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: "Failed to load sync report",
    },
    async ({ session }) => {
      const job = await getSyncJob(id, session ?? undefined);
      if (!job) throw new NotFoundError(t("api.syncJobNotFound", await getServerLocale()));
      const logs = (job.syncLogs ?? []).map((l) => ({
        id: l.id,
        status: l.status,
        filesScanned: l.filesScanned,
        filesTransferred: l.filesTransferred,
        filesDeleted: l.filesDeleted,
        bytesTransferred: l.bytesTransferred,
        durationMs: l.durationMs,
        errorMessage: l.errorMessage,
        startedAt: l.startedAt.toISOString(),
        completedAt: l.completedAt?.toISOString() ?? null,
      }));
      const report = buildSyncReportView({
        syncType: job.syncType,
        lastSyncResult: job.lastSyncResult,
        logs,
      });
      return NextResponse.json({
        job: {
          id: job.id,
          name: job.name,
          syncType: job.syncType,
          status: job.status,
          schedule: job.schedule,
          lastSyncAt: job.lastSyncAt?.toISOString() ?? null,
          lastSyncResult: job.lastSyncResult,
          sourcePath: job.sourcePath,
          targetPath: job.targetPath,
        },
        report,
      });
    },
  );
}
