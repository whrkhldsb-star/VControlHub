"use client";

/**
 * `exportConversationToMarkdown` — fetches the full transcript for a
 * conversation and triggers a browser download of a Markdown file.
 *
 * Extracted from ai-client.tsx in R31 as a free function. The caller
 * still owns the active provider name + i18n closure.
 */
import { csrfFetch } from "@/lib/auth/csrf-client";
import type { Message } from "./ai-types";

export async function exportConversationToMarkdown({
  conversationId,
  providerName,
  t,
}: {
  conversationId: string;
  providerName: string;
  t: (key: string) => string;
}): Promise<void> {
  try {
    const data = await csrfFetch(`/api/ai/conversations/${conversationId}`);
    const conv = data.conversation;
    if (!conv) {
      throw new Error(t("aiPage.exportNotFound"));
    }
    const exportText = [
      `# ${conv.title}`,
      t("aiPage.modelMeta")
        .replace("{model}", conv.model)
        .replace("{provider}", providerName || t("aiPage.modelUnknown")),
      t("aiPage.createdMeta").replace("{date}", conv.createdAt),
      "",
      ...conv.messages.map((m: Message) => {
        const role =
          m.role === "user"
            ? t("aiPage.roleUser")
            : m.role === "assistant"
              ? t("aiPage.roleAssistant")
              : t("aiPage.roleSystem");
        return `---\n${role}:\n\n${m.content}\n`;
      }),
    ].join("\n");
    const blob = new Blob([exportText], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${conv.title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, "_")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(t("aiPage.exportFailed"));
  }
}
