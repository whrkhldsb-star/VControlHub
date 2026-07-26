"use server";

import { revalidatePath } from "next/cache";

import { requirePermission, sessionHasPermission } from "@/lib/auth/authorization";
import { createCommandRequest } from "@/lib/command/service";
import { ForbiddenError } from "@/lib/errors";
import { getServerLocale, t } from "@/lib/i18n/translations";
import { getErrorMessage } from "@/lib/http/error-message";

export type CommandActionState = {
  error?: string;
  success?: string;
};

export async function createCommandRequestAction(_prev: CommandActionState | null, formData: FormData) {
  const session = await requirePermission("command:create");
  const locale = await getServerLocale();
  const tr = (key: string, vars?: Record<string, string | number>) => t(key, locale, vars);

  try {
    const serverIds = formData.getAll("serverIds").map((value) => String(value)).filter(Boolean);
    const submissionMode = String(formData.get("submissionMode") ?? "user");
    const resolvedMode = submissionMode === "assistant" ? "assistant" : "user";
    if (resolvedMode === "user" && !sessionHasPermission(session, "command:execute")) {
      throw new ForbiddenError(
        "command:execute permission is required for direct (user) submission mode",
      );
    }

    await createCommandRequest(
      {
        title: String(formData.get("title") ?? ""),
        command: String(formData.get("command") ?? ""),
        reason: String(formData.get("reason") ?? ""),
        submissionMode: resolvedMode,
        requesterId: session.userId,
        serverIds,
      },
      session,
    );

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/requests");

    return {
      success:
        resolvedMode === "assistant"
          ? tr("serversPage.command.actionAssistantSuccess")
          : tr("serversPage.command.actionUserSuccess"),
    } satisfies CommandActionState;
  } catch (error) {
    return { error: getErrorMessage(error, tr("serversPage.command.actionFailed")) } satisfies CommandActionState;
  }
}
