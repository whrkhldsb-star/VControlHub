import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { BACKUP_CREATE_JOB_TYPE } from "@/lib/backup/job-worker";
import { prepareBackupRecordRetry } from "@/lib/backup/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "backup:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: "Operation failed" }, async ({ session }) => {
    const { id } = await params;
    const backup = await prepareBackupRecordRetry({ id });
    const job = await enqueueJob({
      type: BACKUP_CREATE_JOB_TYPE,
      title: `Retry ${backup.type} backup`,
      payload: { backupId: backup.id },
      createdBy: session?.userId ?? null,
      maxAttempts: 1,
    });
    auditUserAction(session!.userId, "backup.retry", { backupId: id });
    return NextResponse.json({ backup, jobId: job.id, taskId: `job:${job.id}` }, { status: 202 });
  });
}
