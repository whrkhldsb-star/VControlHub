"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/require-session";
import { changePassword } from "@/lib/auth/service";

export type AccountPasswordActionState = {
  error?: string;
  success?: string;
};

export async function changePasswordAction(
  _prevState: AccountPasswordActionState | null,
  formData: FormData,
) {
  const session = await requireSession("/account/password");

  try {
    const result = await changePassword({
      userId: session.userId,
      currentPassword: String(formData.get("currentPassword") ?? ""),
      newPassword: String(formData.get("newPassword") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
    });

    if (!result.success) {
      return {
        error: result.error ?? "修改密码失败",
      } satisfies AccountPasswordActionState;
    }

    revalidatePath("/");
    revalidatePath("/account/password");

    return {
      success: "密码已更新。下次登录请使用新密码。",
    } satisfies AccountPasswordActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "修改密码失败",
    } satisfies AccountPasswordActionState;
  }
}
