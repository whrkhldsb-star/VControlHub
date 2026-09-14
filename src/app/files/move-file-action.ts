"use server";

import { requirePermission } from "@/lib/auth/authorization";
import { executeMoveFile, type MoveFileActionState } from "@/lib/files/move-operation";
export type { MoveFileActionState } from "@/lib/files/move-operation";

export async function moveFileAction(_prev: MoveFileActionState | null, formData: FormData) {
  return executeMoveFile(await requirePermission("storage:write"), formData);
}
