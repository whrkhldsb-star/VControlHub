import { NextResponse } from "next/server";
import { z } from "zod";

import { createBackupRecord, listBackupRecords, runBackupRecord } from "@/lib/backup/service";
import { BACKUP_CREATE_JOB_TYPE } from "@/lib/backup/job-worker";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";

export const dynamic = "force-dynamic";

const createBackupSchema = z.object({
  type: z.enum(["DATABASE", "FILES", "FULL"]),
  note: z.string().trim().max(500, "备注最多 500 个字符").optional(),
});

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "backup:read" }, async () => {
    return NextResponse.json({ backups: await listBackupRecords() });
  });
}

async function readRequestBody(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    return {
      type: formData.get("type"),
      note: formData.get("note") || undefined,
    };
  }
  return request.json().catch(() => ({}));
}

export async function POST(request: Request) {
  return withApiRoute(request, { permission: "backup:create", rateLimit: GENERAL_WRITE_LIMIT, errorStatus: 500, errorMessage: "操作失败" }, async ({ session }) => {
    const body = await readRequestBody(request);
    const parsed = createBackupSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "备份参数无效" }, { status: 400 });
    const waitForCompletion = new URL(request.url).searchParams.get("wait") === "1";
    if (waitForCompletion) {
      const backup = await runBackupRecord({ type: parsed.data.type, createdBy: session?.userId ?? "", note: parsed.data.note });
      if ((request.headers.get("accept") || "").includes("text/html")) {
        return NextResponse.redirect(new URL("/backups", request.url), { status: 303 });
      }
      return NextResponse.json({ backup }, { status: 201 });
    }

    const backup = await createBackupRecord({ type: parsed.data.type, createdBy: session?.userId ?? "", note: parsed.data.note });
    const job = await enqueueJob({
      type: BACKUP_CREATE_JOB_TYPE,
      title: `创建${parsed.data.type}备份`,
      payload: { backupId: backup.id },
      createdBy: session?.userId ?? null,
      maxAttempts: 1,
    });
    if ((request.headers.get("accept") || "").includes("text/html")) {
      return NextResponse.redirect(new URL("/backups", request.url), { status: 303 });
    }
    return NextResponse.json({ backup, jobId: job.id, taskId: `job:${job.id}` }, { status: 202 });
  });
}
