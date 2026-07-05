import type { getConversationById } from "@/lib/ai/service";
import { t, type Locale } from "@/lib/i18n/translations";

export type HistoryMessage = {
  role: "user" | "assistant" | "system" | "tool";
  content:
    | string
    | Array<{
        type: "text" | "image_url";
        text?: string;
        image_url?: { url: string; detail?: string };
      }>;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
};

type AiChatBody = {
  content?: string;
  imageUrls?: string[];
  imageBase64?: Array<{ mimeType: string; data: string }>;
  fileAttachments?: Array<{ name: string; content: string }>;
};

type ConversationForAiChat = Awaited<ReturnType<typeof getConversationById>>;

export function buildAiChatMessagePayload(input: {
  body: AiChatBody;
  conv: ConversationForAiChat;
  isVisionCapable: boolean;
  locale: Locale;
}): { allImageUrls: string[]; historyMessages: HistoryMessage[]; userText: string } {
  const { body, conv, isVisionCapable, locale } = input;
  const historyMessages: HistoryMessage[] = [];

  if (conv.systemPrompt) {
    historyMessages.push({ role: "system", content: conv.systemPrompt });
  }

  for (const msg of conv.messages) {
    if (msg.role === "system") continue;

    if (msg.role === "tool") {
      historyMessages.push({ role: "tool", content: msg.content, tool_call_id: msg.toolCallId || undefined });
      continue;
    }

    const toolCallsData = JSON.parse(msg.toolCalls || "[]");
    if (msg.role === "assistant" && toolCallsData.length > 0) {
      historyMessages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCallsData });
      continue;
    }

    if (msg.role === "user" && isVisionCapable) {
      const imgUrls: string[] = JSON.parse(msg.imageUrls || "[]");
      if (imgUrls.length > 0) {
        const content: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }> = [
          { type: "text", text: msg.content },
        ];
        for (const u of imgUrls) content.push({ type: "image_url", image_url: { url: u } });
        historyMessages.push({ role: "user", content });
        continue;
      }
    }

    historyMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
  }

  const userText = (body.content ?? "").trim();
  const userImageUrls = body.imageUrls ?? [];
  const userImageBase64 = body.imageBase64 ?? [];
  const userFiles = body.fileAttachments ?? [];
  const hasImages = isVisionCapable && (userImageUrls.length > 0 || userImageBase64.length > 0);
  const hasFiles = userFiles.length > 0;

  let fullText = userText;
  if (hasFiles) {
    const fileParts = userFiles.map((f) => `--- File: ${f.name} ---\n${f.content}\n--- End of ${f.name} ---`).join("\n\n");
    fullText = `${userText}${t("apiAiChat.attachmentPrefix", locale)}${fileParts}`;
  }

  if (hasImages) {
    const content: Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string; detail?: string } }> = [
      { type: "text", text: fullText },
    ];
    for (const url of userImageUrls) content.push({ type: "image_url", image_url: { url } });
    for (const img of userImageBase64) {
      content.push({ type: "image_url", image_url: { url: `data:${img.mimeType};base64,${img.data}` } });
    }
    historyMessages.push({ role: "user", content });
  } else {
    historyMessages.push({ role: "user", content: fullText });
  }

  const allImageUrls = [
    ...userImageUrls,
    ...userImageBase64.map((img) => `data:${img.mimeType};base64,...(${img.data.length} chars)`),
  ];

  return { allImageUrls, historyMessages, userText };
}
