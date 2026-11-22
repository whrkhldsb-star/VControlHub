import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import { requestLocale, withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import {
  createBackupRecord,
  listBackupRecords,
  runBackupRecord,
} from "@/lib/backup/service";
import { BACKUP_CREATE_JOB_TYPE } from "@/lib/backup/job-worker";
import { createBackupSchema } from "@/lib/backup/schema";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/job/service";

import { ValidationError, BusinessError } from "@/lib/errors";
import { auditUserAction } from "@/lib/audit/service";
import { rejectOversizedFormBody } from "@/lib/http/form-body-limit";
import { MAX_NON_FILE_FORM_BYTES } from "@/lib/http/request-body";
import { t } from "@/lib/i18n/service-translations";
import { firstSchemaSentence } from "@/lib/i18n/schema-copy";
import { containsNul } from "@/lib/text/strip-nul";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "backup:read" }, async ({ session }) => {
    const backups = await listBackupRecords(session);
    return NextResponse.json({ backups, summary: backups.policySummary });
  });
}

async function readRequestBody(request: Request) {
  const formData = await request.formData();
  for (const [key, value] of formData.entries()) {
    if (containsNul(key) || (typeof value === "string" && containsNul(value))) {
      throw new ValidationError(t("backend.http.requestContainsNul"), { field: "body" });
    }
  }
  return {
    type: formData.get("type"),
    note: formData.get("note") || undefined,
  };
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const isFormSubmission = contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data");
  // Form posts are parsed manually below — reject oversized / chunked bodies
  // up front (formData() would otherwise buffer unbounded bytes).
  const rejected = isFormSubmission
    ? rejectOversizedFormBody(request, MAX_NON_FILE_FORM_BYTES, {
        tooLargeMessage: t("backend.request.bodyTooLarge", await requestLocale(request)),
      })
    : null;
  if (rejected) return rejected;
  const options = {
    permission: "backup:create" as const,
    rateLimit: GENERAL_WRITE_LIMIT,
    errorStatus: 500,
    errorMessage: apiCopy("apiCopy.operation.failed.4e1af7c7"),
    ...(isFormSubmission ? {} : { bodySchema: createBackupSchema }),
  };
  return withApiRoute(request, options, async ({ session, body }) => {
    const rawForm = isFormSubmission ? await readRequestBody(request) : null;
    if (rawForm && containsNul(rawForm)) {
      throw new ValidationError(t("backend.http.requestContainsNul"), { field: "body" });
    }
    const parsed = isFormSubmission ? createBackupSchema.safeParse(rawForm) : { success: true as const, data: body };
    if (!parsed.success) throw new ValidationError(firstSchemaSentence(parsed.error) ?? "Invalid backup parameters");
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
      const backup = await runBackupRecord({ type: parsed.data.type, createdBy: session.userId, note: parsed.data.note, teamId: null });
      // runBackupRecord returns FAILED records without throwing — surface as BusinessError.
      if (backup.status !== "COMPLETED") {
        throw new BusinessError(backup.errorMessage?.slice(0, 500) || `Backup finished with status ${backup.status}`);
      }
      // Before the redirect: a form submission (Accept: text/html) used to
      // return here first and left no audit entry for the backup it made.
      await auditUserAction(session.userId, "backup.create", { backupId: backup.id }, undefined, null);
      if ((request.headers.get("accept") || "").includes("text/html")) {
        return NextResponse.redirect(new URL("/backups", request.url), { status: 303 });
      }
      return NextResponse.json({ backup }, { status: 201 });
    }

    const { backup, job } = await prisma.$transaction(async (tx) => {
      const backup = await createBackupRecord({ type: parsed.data.type, createdBy: session.userId, note: parsed.data.note, teamId: null }, tx);
      const job = await enqueueJob({
        type: BACKUP_CREATE_JOB_TYPE,
        title: `Create ${backup.type} backup`,
        payload: { backupId: backup.id, teamId: backup.teamId },
        createdBy: session.userId,
        teamId: backup.teamId,
        maxAttempts: 1,
      }, tx);
      return { backup, job };
    });
    await auditUserAction(session.userId, "backup.create", {
      backupId: backup.id,
      jobId: job.id,
      async: true,
    }, undefined, null);
    if ((request.headers.get("accept") || "").includes("text/html")) {
      return NextResponse.redirect(new URL("/backups", request.url), { status: 303 });
    }
    return NextResponse.json({ backup, jobId: job.id, taskId: `job:${job.id}` }, { status: 202 });
  });
}
