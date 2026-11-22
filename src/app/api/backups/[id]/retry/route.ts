import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { BACKUP_CREATE_JOB_TYPE } from "@/lib/backup/job-worker";
import { getBackupRecord, prepareBackupRecordRetry } from "@/lib/backup/service";
import { NotFoundError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "backup:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: apiCopy("apiCopy.operation.failed.4e1af7c7") }, async ({ session }) => {
    const { id } = await params;
    const result = await prisma.$transaction(async (tx) => {
      const record = await getBackupRecord(id, session, tx);
      if (!record) throw new NotFoundError(t("backend.backup.recordNotFound"));
      const existing = await tx.job.findFirst({
        where: {
          teamId: record.teamId, type: BACKUP_CREATE_JOB_TYPE,
          status: { in: ["PENDING", "RUNNING"] }, payload: { path: ["backupId"], equals: record.id },
        },
        select: { id: true },
      });
      if (existing) return { jobId: existing.id, deduped: true };
      const backup = await prepareBackupRecordRetry({ id, session }, tx);
      const job = await enqueueJob({
        type: BACKUP_CREATE_JOB_TYPE, title: `Retry ${backup.type} backup`,
        payload: { backupId: id, teamId: backup.teamId }, createdBy: session.userId, teamId: backup.teamId, maxAttempts: 1,
      }, tx);
      return { backup, jobId: job.id, deduped: false };
    });
    await auditUserAction(session.userId, "backup.retry", { backupId: id, jobId: result.jobId, deduped: result.deduped }, undefined, null);
    return NextResponse.json({ ...result, taskId: `job:${result.jobId}` }, { status: 202 });
  });
}
