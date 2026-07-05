"use server";

import { revalidatePath } from "next/cache";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
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
    note: parsed.data.note,
  });
  await enqueueJob({
    type: BACKUP_CREATE_JOB_TYPE,
    title: tr("backupsPage.action.jobTitle").replace("{type}", parsed.data.type),
    payload: { backupId: backup.id },
    createdBy: session.userId,
    maxAttempts: 1,
  });
  revalidatePath("/backups");
  return { success: true };
}
