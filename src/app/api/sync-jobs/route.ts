import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * GET  /api/sync-jobs — list team-scoped sync jobs
 * POST /api/sync-jobs — create (MIRROR | BACKUP | INCREMENTAL | BIDIRECTIONAL)
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { createSyncJob, listSyncJobs } from "@/lib/sync/service-crud";
import { effectiveDeleteOrphans } from "@/lib/sync/bidirectional";
import { isValidSyncSchedule, normalizeSyncSchedule } from "@/lib/sync/schedule";
import { ValidationError } from "@/lib/errors";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  sourceServerId: z.string().trim().min(1),
  sourcePath: z.string().trim().min(1),
  targetServerId: z.string().trim().min(1),
  targetPath: z.string().trim().min(1),
  syncType: z
    .enum(["MIRROR", "BACKUP", "INCREMENTAL", "BIDIRECTIONAL"])
    .optional()
    .default("MIRROR"),
  schedule: z.string().trim().max(80).optional().nullable(),
  deleteOrphans: z.boolean().optional().default(false),
  compress: z.boolean().optional().default(false),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: apiCopy("apiCopy.failed.to.list.sync.jobs.293dd5ca"),
    },
    async ({ session }) => {
      const jobs = await listSyncJobs(session);
      return NextResponse.json({
        jobs: jobs.map((j) => ({
          id: j.id,
          name: j.name,
          sourceServerId: j.sourceServerId,
          targetServerId: j.targetServerId,
          sourcePath: j.sourcePath,
          targetPath: j.targetPath,
          syncType: j.syncType,
          status: j.status,
          schedule: j.schedule,
          deleteOrphans: j.deleteOrphans,
          compress: j.compress,
          lastSyncAt: j.lastSyncAt?.toISOString() ?? null,
          lastSyncResult: j.lastSyncResult,
          sourceServer: j.sourceServer,
          targetServer: j.targetServer,
          logCount: j._count.syncLogs,
          teamId: j.teamId,
          createdAt: j.createdAt.toISOString(),
        })),
      });
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      bodySchema: createSchema,
      errorMessage: apiCopy("apiCopy.failed.to.create.sync.job.87fb8a7f"),
    },
    async ({ session, body }) => {
      if (body.schedule != null && body.schedule !== "" && !isValidSyncSchedule(body.schedule)) {
        throw new ValidationError(apiCopy("apiCopy.invalid.schedule.use.manual.every.15m.1h.6h.24h.or.5.field.cron.2a660f19"));
      }
      const job = await createSyncJob({
        name: body.name,
        sourceServerId: body.sourceServerId,
        sourcePath: body.sourcePath,
        targetServerId: body.targetServerId,
        targetPath: body.targetPath,
        syncType: body.syncType,
        schedule: normalizeSyncSchedule(body.schedule) ?? undefined,
        deleteOrphans: effectiveDeleteOrphans(body.syncType, body.deleteOrphans),
        compress: body.compress,
        createdBy: session.userId,
        session,
      });
      await auditUserAction(session.userId, "sync_job.create", {
        jobId: job.id,
        syncType: job.syncType,
        sourceServerId: job.sourceServerId,
        targetServerId: job.targetServerId,
      }, undefined, session.currentTeamId);
      return NextResponse.json({ job }, { status: 201 });
    },
  );
}
