"use server";

import { revalidatePath } from "next/cache";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";
import { enqueueJob } from "@/lib/job/service";
import { BACKUP_CREATE_JOB_TYPE } from "@/lib/backup/job-worker";
import { createBackupRecord } from "@/lib/backup/service";

export type BackupActionState = {
  success: boolean;
  error?: string;
};

const BACKUP_TYPES = new Set(["DATABASE", "FILES", "FULL"]);

export async function createBackupAction(_prev: BackupActionState, formData: FormData): Promise<BackupActionState> {
  const session = await requireSession("/backups");
  if (!sessionHasPermission(session, "backup:create")) {
    return { success: false, error: "缺少权限" };
  }

  const type = String(formData.get("type") || "").trim();
  const note = String(formData.get("note") || "").trim();

  if (!BACKUP_TYPES.has(type)) {
    return { success: false, error: "备份类型无效" };
  }
  if (note.length > 500) {
    return { success: false, error: "备注最多 500 个字符" };
  }

  const backup = await createBackupRecord({
    type: type as "DATABASE" | "FILES" | "FULL",
    createdBy: session.userId,
    note: note || undefined,
  });
  await enqueueJob({
    type: BACKUP_CREATE_JOB_TYPE,
    title: `创建${type}备份`,
    payload: { backupId: backup.id },
    createdBy: session.userId,
    maxAttempts: 1,
  });
  revalidatePath("/backups");
  return { success: true };
}
