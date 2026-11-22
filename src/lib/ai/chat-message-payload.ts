import type { getConversationById } from "./service";
import { t, type Locale } from "@/lib/i18n/service-translations";

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

/**
 * What the replayed history may weigh, in characters (about 25,000-100,000 tokens, depending on the language). A thread
 * had only a row-count window (500 rows), far beyond any model's context: after enough turns, or one large text
 * attachment (each is stored whole and resent every turn), the provider answered "context length exceeded" to every
 * later message, and the only way out was a new conversation.
 */
export const AI_HISTORY_CHAR_BUDGET = 100_000;
/** What an image in the history counts for, whatever its address (its bytes are not text). */
const IMAGE_CHAR_COST = 2_000;

function messageWeight(message: HistoryMessage): number {
  const content = typeof message.content === "string"
    ? message.content.length
    : message.content.reduce((sum, part) => sum + (part.type === "text" ? (part.text?.length ?? 0) : IMAGE_CHAR_COST), 0);
  const calls = message.tool_calls?.reduce((sum, call) => sum + call.function.name.length + call.function.arguments.length, 0) ?? 0;
  return content + calls;
}

/**
 * The oldest whole turns (a user message and what followed it, tool calls with their results) are left out until the rest
 * fits the budget; the newest turn always stays, and so does the system prompt.
 */
export function fitHistoryToBudget(messages: HistoryMessage[], budget = AI_HISTORY_CHAR_BUDGET): HistoryMessage[] {
  const system = messages.filter((message) => message.role === "system");
  let rest = messages.filter((message) => message.role !== "system");
  const weight = (list: HistoryMessage[]) => list.reduce((sum, message) => sum + messageWeight(message), 0);
  const systemWeight = weight(system);
  while (rest.length > 0 && systemWeight + weight(rest) > budget) {
    const nextTurn = rest.findIndex((message, index) => index > 0 && message.role === "user");
    if (nextTurn === -1) break; // one turn left: it is the one being asked
    rest = rest.slice(nextTurn);
  }
  return [...system, ...rest];
}

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

export function isChatImageUrl(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 2048) return false;
  try { return /^https?:$/.test(new URL(url).protocol); } catch { return false; }
}

export function buildAiChatMessagePayload(input: {
  body: AiChatBody;
  conv: ConversationForAiChat;
  isVisionCapable: boolean;
  locale: Locale;
}): { allImageUrls: string[]; historyMessages: HistoryMessage[]; userText: string; persistedText: string; attachmentMetadata?: string } {
  const { body, conv, isVisionCapable, locale } = input;
  const historyMessages: HistoryMessage[] = [];

  if (conv.systemPrompt) {
    historyMessages.push({ role: "system", content: conv.systemPrompt });
  }

  // The history is the latest window of a long thread, cut by row count: it
  // can begin with tool results whose assistant call fell outside it.
  // Providers reject a result with no matching call, so those are dropped.
  // The window can open mid-thread on an assistant turn; Anthropic rejects a
  // history that does not start with the user, so the history starts at the
  // first user turn (results of calls left out are then dropped below).
  let reachedUserTurn = false;
  for (const [index, msg] of conv.messages.entries()) {
    if (msg.role === "system") continue;
    if (!reachedUserTurn) {
      if (msg.role !== "user") continue;
      reachedUserTurn = true;
    }

    if (msg.role === "tool") continue;
    if (msg.role === "assistant") {
      const calls = safeJsonArray<AiToolCall>(msg.toolCalls);
      const replies = new Map<string, string>();
      for (let j = index + 1; calls.length && conv.messages[j]?.role === "tool"; j++) {
        const reply = conv.messages[j]!;
        if (reply.toolCallId) replies.set(reply.toolCallId, reply.content);
      }
      const answered = calls.filter((call) => replies.has(call.id));
      if (answered.length) {
        historyMessages.push({ role: "assistant", content: msg.content || "", tool_calls: answered });
        for (const call of answered) historyMessages.push({ role: "tool", content: replies.get(call.id)!, tool_call_id: call.id });
        continue;
      }
    }
    if (msg.role === "assistant" && !msg.content) continue;

    if (msg.role === "user" && isVisionCapable) {
      const imageUrls = safeJsonArray<string>(msg.imageUrls).filter(isChatImageUrl);
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
  const imageUrls = (body.imageUrls ?? []).filter(isChatImageUrl);
  const imageBase64 = body.imageBase64 ?? [];
  const files = body.fileAttachments ?? [];
  const hasImages = isVisionCapable && (imageUrls.length > 0 || imageBase64.length > 0);

  let fullText = userText;
  const ranges = files.map((file, index) => {
    fullText += (index ? "\n\n" : t("apiAiChat.attachmentPrefix", locale)) + `--- File: ${file.name} ---\n`;
    const start = fullText.length;
    fullText += file.content;
    const end = fullText.length;
    fullText += `\n--- End of ${file.name} ---`;
    return { name: file.name, start, end };
  });
  const attachmentMetadata = files.length || imageBase64.length
    ? JSON.stringify({ version: 1, textLength: userText.length, ranges, localFiles: imageBase64.length })
    : undefined;

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
  // Text attachments are: `persistedText` is what the model saw this turn, so
  // the next turn (rebuilt from the database) can still refer to the file.
  return { allImageUrls: [...imageUrls], historyMessages: fitHistoryToBudget(historyMessages), userText, persistedText: fullText, attachmentMetadata };
}
