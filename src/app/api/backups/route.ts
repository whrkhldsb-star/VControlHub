import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import {
  createBackupRecord,
  listBackupRecords,
  runBackupRecord,
} from "@/lib/backup/service";
import { BACKUP_CREATE_JOB_TYPE } from "@/lib/backup/job-worker";
import { createBackupSchema } from "@/lib/backup/schema";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { enqueueJob } from "@/lib/job/service";

import { ValidationError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "backup:read" }, async () => {
    return NextResponse.json({ backups: await listBackupRecords() });
  });
}

async function readRequestBody(request: Request) {
  const formData = await request.formData();
  return {
    type: formData.get("type"),
    note: formData.get("note") || undefined,
  };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const isFormSubmission = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  const options = {
    permission: "backup:create" as const,
    rateLimit: GENERAL_WRITE_LIMIT,
    errorStatus: 500,
    errorMessage: "Operation failed",
    ...(isFormSubmission ? {} : { bodySchema: createBackupSchema }),
  };
  return withApiRoute(request, options, async ({ session, body }) => {
    const parsed = isFormSubmission ? createBackupSchema.safeParse(await readRequestBody(request)) : { success: true as const, data: body };
    if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? "Invalid backup parameters");
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
      const backup = await runBackupRecord({ type: parsed.data.type, createdBy: session?.userId ?? "", note: parsed.data.note });
      if ((request.headers.get("accept") || "").includes("text/html")) {
        return NextResponse.redirect(new URL("/backups", request.url), { status: 303 });
      }
      await auditUserAction(session?.userId ?? "", "backup.create", { backupId: backup.id });
      return NextResponse.json({ backup }, { status: 201 });
    }

    const backup = await createBackupRecord({ type: parsed.data.type, createdBy: session?.userId ?? "", note: parsed.data.note });
    const job = await enqueueJob({
      type: BACKUP_CREATE_JOB_TYPE,
      title: `Create ${parsed.data.type} backup`,
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
