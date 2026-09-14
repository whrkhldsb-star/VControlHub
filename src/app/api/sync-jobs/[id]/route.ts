import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * PATCH  /api/sync-jobs/[id] — update schedule / name / paths
 * DELETE /api/sync-jobs/[id] — delete team-scoped sync job
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { ValidationError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { isValidSyncSchedule, normalizeSyncSchedule } from "@/lib/sync/schedule";
import { deleteSyncJob, updateSyncJob } from "@/lib/sync/service-crud";

export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  sourcePath: z.string().trim().min(1).optional(),
  targetPath: z.string().trim().min(1).optional(),
  schedule: z.string().trim().max(80).nullable().optional(),
  compress: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: patchSchema,
      errorMessage: apiCopy("apiCopy.failed.to.update.sync.job.bf8ef139"),
    },
    async ({ session, body }) => {
      if (body.schedule !== undefined && !isValidSyncSchedule(body.schedule)) {
        throw new ValidationError(
          apiCopy("apiCopy.invalid.schedule.use.manual.every.15m.1h.6h.24h.or.5.field.cron.2a660f19"),
        );
      }
      const job = await updateSyncJob(
        id,
        {
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.sourcePath !== undefined ? { sourcePath: body.sourcePath } : {}),
          ...(body.targetPath !== undefined ? { targetPath: body.targetPath } : {}),
          ...(body.schedule !== undefined
            ? { schedule: normalizeSyncSchedule(body.schedule) }
            : {}),
          ...(body.compress !== undefined ? { compress: body.compress } : {}),
        },
        session ?? undefined,
      );
      await auditUserAction(session?.userId ?? "anonymous", "sync_job.update", {
        jobId: id,
        schedule: body.schedule ?? null,
      }, undefined, session?.currentTeamId);
      return NextResponse.json({ success: true, job });
    },
  );
}

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
      errorMessage: apiCopy("apiCopy.failed.to.delete.sync.job.5c1dd345"),
    },
    async ({ session }) => {
      await deleteSyncJob(id, session ?? undefined);
      await auditUserAction(session?.userId ?? "anonymous", "sync_job.delete", {
        jobId: id,
      }, undefined, session?.currentTeamId);
      return NextResponse.json({ success: true });
    },
  );
}
