import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { BACKUP_CREATE_JOB_TYPE } from "@/lib/backup/job-worker";
import { prepareBackupRecordRetry } from "@/lib/backup/service";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "backup:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: "Operation failed" }, async ({ session }) => {
    const { id } = await params;
    // Deduplicate in-flight create jobs for this backupId before CAS re-queue.
    // Double-click / concurrent retry would otherwise leave orphan PENDING jobs after the
    // second prepareBackupRecordRetry fails (record already PENDING from the first CAS).
    const existing = await prisma.job.findFirst({
      where: {
        type: BACKUP_CREATE_JOB_TYPE,
        status: { in: ["PENDING", "RUNNING"] },
        payload: { path: ["backupId"], equals: id },
      },
      select: { id: true },
    });
    if (existing) {
      await auditUserAction(session!.userId, "backup.retry", { backupId: id, jobId: existing.id, deduped: true }, undefined, session?.currentTeamId);
      return NextResponse.json({ jobId: existing.id, taskId: `job:${existing.id}`, deduped: true }, { status: 202 });
    }
    const backup = await prepareBackupRecordRetry({ id, session: session! });
    const job = await enqueueJob({
      type: BACKUP_CREATE_JOB_TYPE,
      title: `Retry ${backup.type} backup`,
      payload: { backupId: backup.id, teamId: session?.currentTeamId ?? backup.teamId ?? null },
      createdBy: session?.userId ?? null,
      teamId: session?.currentTeamId ?? null,
      maxAttempts: 1,
    });
    await auditUserAction(session!.userId, "backup.retry", { backupId: id, jobId: job.id }, undefined, session?.currentTeamId);
    return NextResponse.json({ backup, jobId: job.id, taskId: `job:${job.id}`, deduped: false }, { status: 202 });
  });
}
