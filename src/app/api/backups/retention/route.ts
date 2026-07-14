import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { BACKUP_RETENTION_JOB_TYPE } from "@/lib/backup/job-worker";
import { getBackupPolicySummary } from "@/lib/backup/service";
import { backupRetentionInputSchema } from "@/lib/backup/schema";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";
export const dynamic = "force-dynamic";

/**
 * GET — return the current backup policy summary so the UI can show
 * the current "X records older than 30 days" hint and let the admin
 * decide whether to enqueue a retention cleanup.
 */
export async function GET(request: Request) {
  return withApiRoute(request, { permission: "backup:read" }, async ({ session }) => {
    const summary = await getBackupPolicySummary(session!);
    return NextResponse.json({ summary });
  });
}

/**
 * POST — enqueue a `backup.retention` durable job. The actual work
 * runs in the existing `backup` worker poll loop (5s) and produces a
 * summary payload on `completeJob` that flows through to the
 * operation-task center.
 */
export async function POST(request: Request) {
  return withApiRoute(request, { permission: "backup:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: "Operation failed", bodySchema: backupRetentionInputSchema }, async ({ session, body }) => {
    const job = await enqueueJob({
      type: BACKUP_RETENTION_JOB_TYPE,
      title: "Clean up old backups (automatic retention policy)",
      payload: { ...body, teamId: session?.currentTeamId ?? null },
      createdBy: session?.userId ?? null,
      teamId: session?.currentTeamId ?? null,
      maxAttempts: 1,
    });
    await auditUserAction(session?.userId ?? "", "backup.retention.enqueue", {
      jobId: job.id,
      payload: body,
    });
    return NextResponse.json({ jobId: job.id, taskId: `job:${job.id}` }, { status: 202 });
  });
}
