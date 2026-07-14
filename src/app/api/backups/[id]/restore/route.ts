import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { BACKUP_RESTORE_JOB_TYPE } from "@/lib/backup/job-worker";
import { restoreBackupSchema } from "@/lib/backup/schema";
import { getBackupRecord, restoreBackupRecord } from "@/lib/backup/service";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";

import { NotFoundError } from "@/lib/errors";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(
    request,
    {
      permission: "backup:restore",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Restore failed",
      bodySchema: restoreBackupSchema,
    },
    async ({ session, body }) => {
      const { id } = await params;
      try {
        const { wait } = parseSearchParams(
          request,
          z.object({
            wait: z
              .string()
              .optional()
              .transform((value) => value === "1"),
          }),
        );
        const waitForCompletion = wait;
        if (waitForCompletion) {
          const restore = await restoreBackupRecord({ id, confirm: body.confirm, component: body.component, session: session! });
          await auditUserAction(session!.userId, "backup.restore", { backupId: id });
          return NextResponse.json({ restore });
        }
        const backup = await getBackupRecord(id, session!);
        if (!backup) throw new NotFoundError("Backup record not found");
        if (backup.status !== "COMPLETED") {
          return NextResponse.json({ error: "Only completed backups can be restored" }, { status: 400 });
        }
        // Deduplicate in-flight restore jobs for the same backupId.
        const { prisma } = await import("@/lib/db");
        const existing = await prisma.job.findFirst({
          where: {
            type: BACKUP_RESTORE_JOB_TYPE,
            status: { in: ["PENDING", "RUNNING"] },
            // JSON path filter for backupId
            payload: { path: ["backupId"], equals: id },
          },
          select: { id: true },
        });
        if (existing) {
          await auditUserAction(session!.userId, "backup.restore", {
            backupId: id,
            jobId: existing.id,
            deduped: true,
          });
          return NextResponse.json({ jobId: existing.id, taskId: `job:${existing.id}`, deduped: true }, { status: 202 });
        }
        const job = await enqueueJob({
          type: BACKUP_RESTORE_JOB_TYPE,
          title: "Restore backup",
          payload: { backupId: id, confirm: body.confirm, component: body.component },
          createdBy: session?.userId ?? null,
          teamId: session?.currentTeamId ?? null,
          maxAttempts: 1,
        });
        await auditUserAction(session!.userId, "backup.restore", { backupId: id, jobId: job.id });
        return NextResponse.json({ jobId: job.id, taskId: `job:${job.id}` }, { status: 202 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Restore execution failed";
        const status = message.includes("not found") ? 404 : message.includes("confirm") || message.includes("completed") || message.includes("path") || message.includes("checksum") ? 400 : 500;
        return NextResponse.json({ error: message }, { status });
      }
    },
  );
}
