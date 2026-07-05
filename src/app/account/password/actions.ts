"use server";

import { revalidatePath } from "next/cache";

import { requireSession } from "@/lib/auth/require-session";
import { changePassword } from "@/lib/auth/service";
import { getServerLocale, t } from "@/lib/i18n/translations";

export type AccountPasswordActionState = {
  error?: string;
  success?: string;
};

export async function changePasswordAction(
  _prevState: AccountPasswordActionState | null,
  formData: FormData,
) {
  const session = await requireSession("/account/password");
  const locale = await getServerLocale();
  const tr = (key: string) => t(key, locale);

  try {
    const result = await changePassword({
      userId: session.userId,
      currentPassword: String(formData.get("currentPassword") ?? ""),
      newPassword: String(formData.get("newPassword") ?? ""),
      confirmPassword: String(formData.get("confirmPassword") ?? ""),
    });

    if (!result.success) {
      return {
        error: result.error ?? tr("accountPasswordPage.action.errorFallback"),
      } satisfies AccountPasswordActionState;
    }

    revalidatePath("/");
    revalidatePath("/account/password");

    return {
      success: tr("accountPasswordPage.action.success"),
    } satisfies AccountPasswordActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : tr("accountPasswordPage.action.errorFallback"),
    } satisfies AccountPasswordActionState;
  }
}
