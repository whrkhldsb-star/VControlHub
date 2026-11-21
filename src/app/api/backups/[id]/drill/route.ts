import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { BACKUP_DRILL_JOB_TYPE } from "@/lib/backup/job-worker";
import { getBackupRecord } from "@/lib/backup/service";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "backup:restore", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: apiCopy("apiCopy.backup.drill.failed.31051e85") }, async ({ session }) => {
    const { id } = await params;
    const { job, deduped } = await prisma.$transaction(async (tx) => {
      await lockForTransaction(tx, "backup-drill", id);
      const backup = await getBackupRecord(id, session, tx);
      if (!backup) throw new NotFoundError(t("api.backupNotFound"));
      if (backup.status !== "COMPLETED") throw new ValidationError(t("api.onlyCompletedCanDrill"));
      const existing = await tx.job.findFirst({
        where: { type: BACKUP_DRILL_JOB_TYPE, status: { in: ["PENDING", "RUNNING"] }, payload: { path: ["backupId"], equals: id } },
        select: { id: true },
      });
      if (existing) return { job: existing, deduped: true };
      const job = await enqueueJob({ type: BACKUP_DRILL_JOB_TYPE, title: `Drill ${backup.type} backup`, payload: { backupId: id, teamId: session.currentTeamId ?? backup.teamId ?? null }, createdBy: session.userId, teamId: session.currentTeamId, maxAttempts: 1 }, tx);
      return { job, deduped: false };
    });
    if (!deduped) await auditUserAction(session.userId, "backup.drill", { backupId: id, jobId: job.id, destructive: false }, undefined, session.currentTeamId);
    return NextResponse.json({ jobId: job.id, taskId: `job:${job.id}`, deduped }, { status: 202 });
  });
}
