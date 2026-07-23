"use server";

import { revalidatePath } from "next/cache";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { auditUserAction } from "@/lib/audit/service";
import { enqueueJob } from "@/lib/job/service";
import { BACKUP_CREATE_JOB_TYPE } from "@/lib/backup/job-worker";
import { createBackupSchema } from "@/lib/backup/schema";
import { createBackupRecord } from "@/lib/backup/service";
import { getServerLocale, t } from "@/lib/i18n/translations";

export type BackupActionState = {
  success: boolean;
  error?: string;
};

export async function createBackupAction(_prev: BackupActionState, formData: FormData): Promise<BackupActionState> {
  const session = await requireSession("/backups");
  const locale = await getServerLocale();
  const tr = (key: string) => t(key, locale);
  if (!sessionHasPermission(session, "backup:create")) {
    return { success: false, error: tr("backupsPage.action.noPermission") };
  }

  const parsed = createBackupSchema.safeParse({
    type: String(formData.get("type") || "").trim(),
    note: String(formData.get("note") || ""),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? tr("backupsPage.action.invalidInput") };
  }

  const backup = await createBackupRecord({
    type: parsed.data.type,
    createdBy: session.userId,
    teamId: session.currentTeamId ?? null,
    note: parsed.data.note,
  });
  let job;
  try {
    job = await enqueueJob({
      type: BACKUP_CREATE_JOB_TYPE,
      title: tr("backupsPage.action.jobTitle").replace("{type}", tr(`backupsPage.action.typeLabel.${parsed.data.type}`)),
      payload: { backupId: backup.id, teamId: session.currentTeamId ?? backup.teamId ?? null },
      createdBy: session.userId,
      teamId: session.currentTeamId ?? null,
      maxAttempts: 1,
    });
  } catch (enqueueErr) {
    const { updateBackupRecordStatus } = await import("@/lib/backup/service");
    await updateBackupRecordStatus(backup.id, {
      status: "FAILED",
      errorMessage:
        enqueueErr instanceof Error ? enqueueErr.message : "Failed to enqueue backup job",
      completedAt: new Date(),
    }).catch(() => undefined);
    return {
      success: false,
      error: enqueueErr instanceof Error ? enqueueErr.message : tr("backupsPage.action.enqueueFailed"),
    };
  }
  await auditUserAction(session.userId, "backup.create", {
    backupId: backup.id,
    jobId: job.id,
    async: true,
    via: "server-action",
  }, undefined, session.currentTeamId);
  revalidatePath("/backups");
  return { success: true };
}
