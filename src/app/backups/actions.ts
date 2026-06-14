"use server";

import { revalidatePath } from "next/cache";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { enqueueJob } from "@/lib/job/service";
import { BACKUP_CREATE_JOB_TYPE } from "@/lib/backup/job-worker";
import { createBackupSchema } from "@/lib/backup/schema";
import { createBackupRecord } from "@/lib/backup/service";

export type BackupActionState = {
  success: boolean;
  error?: string;
};

export async function createBackupAction(_prev: BackupActionState, formData: FormData): Promise<BackupActionState> {
  const session = await requireSession("/backups");
  if (!sessionHasPermission(session, "backup:create")) {
    return { success: false, error: "缺少权限" };
  }

  const parsed = createBackupSchema.safeParse({
    type: String(formData.get("type") || "").trim(),
    note: String(formData.get("note") || ""),
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "备份参数无效" };
  }

  const backup = await createBackupRecord({
    type: parsed.data.type,
    createdBy: session.userId,
    note: parsed.data.note,
  });
  await enqueueJob({
    type: BACKUP_CREATE_JOB_TYPE,
    title: `创建${parsed.data.type}备份`,
    payload: { backupId: backup.id },
    createdBy: session.userId,
    maxAttempts: 1,
  });
  revalidatePath("/backups");
  return { success: true };
}
