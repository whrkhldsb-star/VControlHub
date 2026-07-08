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
          const restore = await restoreBackupRecord({ id, confirm: body.confirm });
          auditUserAction(session!.userId, "backup.restore", { backupId: id });
          return NextResponse.json({ restore });
        }
        const backup = await getBackupRecord(id);
        if (!backup) throw new NotFoundError("Backup record not found");
        const job = await enqueueJob({
          type: BACKUP_RESTORE_JOB_TYPE,
          title: "Restore backup",
          payload: { backupId: id, confirm: body.confirm },
          createdBy: null,
          maxAttempts: 1,
        });
        auditUserAction(session!.userId, "backup.restore", { backupId: id });
        return NextResponse.json({ jobId: job.id, taskId: `job:${job.id}` }, { status: 202 });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Restore execution failed";
        const status = message.includes("not found") ? 404 : message.includes("confirm") || message.includes("completed") || message.includes("path") ? 400 : 500;
        return NextResponse.json({ error: message }, { status });
      }
    },
  );
}
