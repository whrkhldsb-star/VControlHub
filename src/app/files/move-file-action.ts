"use server";

import { requirePermission } from "@/lib/auth/authorization";
import { executeMoveFile, type MoveFileActionState } from "@/lib/files/move-operation";
import { FileOperationUncertainError } from "@/lib/files/operation-schema";
import { withServerActionLocale } from "@/lib/i18n/server-locale";
export type { MoveFileActionState } from "@/lib/files/move-operation";

export async function moveFileAction(_prev: MoveFileActionState | null, formData: FormData): Promise<MoveFileActionState> {
  return withServerActionLocale(() => moveFileActionImpl(_prev, formData));
}

async function moveFileActionImpl(_prev: MoveFileActionState | null, formData: FormData): Promise<MoveFileActionState> {
  try {
    return await executeMoveFile(await requirePermission("storage:write"), formData);
  } catch (error) {
    if (error instanceof FileOperationUncertainError)
      return { error: error.message, needsReconcile: true } satisfies MoveFileActionState;
    throw error;
  }
}
