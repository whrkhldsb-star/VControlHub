"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";
import { createCommandRequest } from "@/lib/command/service";
import { getServerLocale, t } from "@/lib/i18n/translations";

export type CommandActionState = {
  error?: string;
  success?: string;
};

export async function createCommandRequestAction(_prev: CommandActionState | null, formData: FormData) {
  const session = await requirePermission("command:create");
  const locale = await getServerLocale();
  const tr = (key: string) => t(key, locale);

  try {
    const serverIds = formData.getAll("serverIds").map((value) => String(value)).filter(Boolean);
    const submissionMode = String(formData.get("submissionMode") ?? "user");

    await createCommandRequest({
      title: String(formData.get("title") ?? ""),
      command: String(formData.get("command") ?? ""),
      reason: String(formData.get("reason") ?? ""),
      submissionMode: submissionMode === "assistant" ? "assistant" : "user",
      requesterId: session.userId,
      serverIds,
    });

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/requests");

    return {
      success:
        submissionMode === "assistant"
          ? tr("serversPage.command.actionAssistantSuccess")
          : tr("serversPage.command.actionUserSuccess"),
    } satisfies CommandActionState;
  } catch (error) {
    return { error: error instanceof Error ? error.message : tr("serversPage.command.actionFailed") } satisfies CommandActionState;
  }
}
