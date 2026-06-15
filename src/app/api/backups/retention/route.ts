import { NextResponse } from "next/server";
import { z } from "zod";

import { BACKUP_RETENTION_JOB_TYPE } from "@/lib/backup/job-worker";
import { getBackupPolicySummary } from "@/lib/backup/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";

import { ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

/**
 * GET — return the current backup policy summary so the UI can show
 * the current "X records older than 30 days" hint and let the admin
 * decide whether to enqueue a retention cleanup.
 */
export async function GET(request: Request) {
  return withApiRoute(request, { permission: "backup:read" }, async () => {
    const summary = await getBackupPolicySummary();
    return NextResponse.json({ summary });
  });
}

const retentionInputSchema = z.object({
  olderThanDays: z.number().int().positive().max(3650).optional(),
  keepLatestPerType: z.number().int().min(0).max(1000).optional(),
});

/**
 * POST — enqueue a `backup.retention` durable job. The actual work
 * runs in the existing `backup` worker poll loop (5s) and produces a
 * summary payload on `completeJob` that flows through to the
 * operation-task center.
 */
export async function POST(request: Request) {
  return withApiRoute(request, { permission: "backup:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: "操作失败" }, async ({ session }) => {
    const body = await request.json().catch(() => ({}));
    const parsed = retentionInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "保留参数无效");
    }
    const job = await enqueueJob({
      type: BACKUP_RETENTION_JOB_TYPE,
      title: "清理旧备份 (自动保留策略)",
      payload: parsed.data,
      createdBy: session?.userId ?? null,
      maxAttempts: 1,
    });
    return NextResponse.json({ jobId: job.id, taskId: `job:${job.id}` }, { status: 202 });
  });
}
