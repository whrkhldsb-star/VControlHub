import type { getConversationById } from "./service";
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
  tool_calls?: AiToolCall[];
};

export type AiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type AiChatBody = {
  content?: string;
  imageUrls?: string[];
  imageBase64?: Array<{ mimeType: string; data: string }>;
  fileAttachments?: Array<{ name: string; content: string }>;
};

type ConversationForAiChat = Awaited<ReturnType<typeof getConversationById>>;

function safeJsonArray<T = unknown>(raw: string | null | undefined): T[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

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

    const toolCalls = safeJsonArray<AiToolCall>(msg.toolCalls);
    if (msg.role === "assistant" && toolCalls.length > 0) {
      historyMessages.push({ role: "assistant", content: msg.content || "", tool_calls: toolCalls });
      continue;
    }

    if (msg.role === "user" && isVisionCapable) {
      const imageUrls = safeJsonArray<string>(msg.imageUrls);
      if (imageUrls.length > 0) {
        historyMessages.push({
          role: "user",
          content: [
            { type: "text", text: msg.content },
            ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
          ],
        });
        continue;
      }
    }

    historyMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
  }

  const userText = (body.content ?? "").trim();
  const imageUrls = body.imageUrls ?? [];
  const imageBase64 = body.imageBase64 ?? [];
  const files = body.fileAttachments ?? [];
  const hasImages = isVisionCapable && (imageUrls.length > 0 || imageBase64.length > 0);

  const fileText = files
    .map((file) => `--- File: ${file.name} ---\n${file.content}\n--- End of ${file.name} ---`)
    .join("\n\n");
  const fullText = fileText
    ? `${userText}${t("apiAiChat.attachmentPrefix", locale)}${fileText}`
    : userText;

  if (hasImages) {
    historyMessages.push({
      role: "user",
      content: [
        { type: "text", text: fullText },
        ...imageUrls.map((url) => ({ type: "image_url" as const, image_url: { url } })),
        ...imageBase64.map((image) => ({
          type: "image_url" as const,
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        })),
      ],
    });
  } else {
    historyMessages.push({ role: "user", content: fullText });
  }

  // Base64 data is provider-only and must never be persisted in chat history.
  return { allImageUrls: [...imageUrls], historyMessages, userText };
}
