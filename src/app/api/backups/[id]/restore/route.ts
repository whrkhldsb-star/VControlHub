import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { BACKUP_RESTORE_JOB_TYPE } from "@/lib/backup/job-worker";
import { restoreBackupSchema } from "@/lib/backup/schema";
import { getBackupRecord, restoreBackupRecord } from "@/lib/backup/service";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";

import { NotFoundError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return withApiRoute(request, { permission: "backup:restore", rateLimit: GENERAL_WRITE_LIMIT, errorMessage: "恢复失败" }, async () => {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const parsed = restoreBackupSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message ?? "恢复确认无效");
    }

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
        const restore = await restoreBackupRecord({ id, confirm: parsed.data.confirm });
        return NextResponse.json({ restore });
      }
      const backup = await getBackupRecord(id);
      if (!backup) throw new NotFoundError("备份记录不存在");
      const job = await enqueueJob({
        type: BACKUP_RESTORE_JOB_TYPE,
        title: "恢复备份",
        payload: { backupId: id, confirm: parsed.data.confirm },
        createdBy: null,
        maxAttempts: 1,
      });
      return NextResponse.json({ jobId: job.id, taskId: `job:${job.id}` }, { status: 202 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "恢复执行失败";
      const status = message.includes("不存在") ? 404 : message.includes("确认") || message.includes("已完成") || message.includes("路径") ? 400 : 500;
      return NextResponse.json({ error: message }, { status });
    }
  });
}
