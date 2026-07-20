import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { BACKUP_DRILL_JOB_TYPE } from "@/lib/backup/job-worker";
import { getBackupRecord } from "@/lib/backup/service";
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "backup:restore", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "Backup drill failed" }, async ({ session }) => {
    const { id } = await params;
    const backup = await getBackupRecord(id, session!);
    if (!backup) throw new NotFoundError("Backup record not found");
    if (backup.status !== "COMPLETED") throw new ValidationError("Only completed backups can be drilled");
    const existing = await prisma.job.findFirst({
      where: { type: BACKUP_DRILL_JOB_TYPE, status: { in: ["PENDING", "RUNNING"] }, payload: { path: ["backupId"], equals: id } },
      select: { id: true },
    });
    if (existing) return NextResponse.json({ jobId: existing.id, taskId: `job:${existing.id}`, deduped: true }, { status: 202 });
    const job = await enqueueJob({ type: BACKUP_DRILL_JOB_TYPE, title: `Drill ${backup.type} backup`, payload: { backupId: id, teamId: session!.currentTeamId ?? backup.teamId ?? null }, createdBy: session!.userId, teamId: session!.currentTeamId, maxAttempts: 1 });
    await auditUserAction(session!.userId, "backup.drill", { backupId: id, jobId: job.id, destructive: false }, undefined, session?.currentTeamId);
    return NextResponse.json({ jobId: job.id, taskId: `job:${job.id}`, deduped: false }, { status: 202 });
  });
}
