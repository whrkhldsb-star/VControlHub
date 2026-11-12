import type { Message } from "./ai-types";

/**
 * The reply written into the transcript when a request fails.
 *
 * It exists in the page only (the server keeps no message for a failed turn), so it is told by its id and not
 * by its text: an answer may begin with any character, a cross mark included. The transcript used to look for
 * a "⚠" at the start while the stream wrote "❌", so a failure was drawn as an ordinary answer.
 */
const STREAM_ERROR_ID_PREFIX = "stream-error-";
const ERROR_MARK = "❌";

export function streamErrorMessage({ conversationId, text, model }: { conversationId: string; text: string; model: string | null }): Message {
	return {
		id: `${STREAM_ERROR_ID_PREFIX}${crypto.randomUUID()}`,
		conversationId,
		role: "assistant",
		content: text.startsWith(ERROR_MARK) ? text : `${ERROR_MARK} ${text}`,
		reasoningContent: null,
		imageUrls: "[]",
		model,
		inputTokens: null,
		outputTokens: null,
		latencyMs: null,
		createdAt: new Date().toISOString(),
	};
}

export function isStreamErrorMessage(message: Pick<Message, "id" | "role">): boolean {
	return message.role === "assistant" && message.id.startsWith(STREAM_ERROR_ID_PREFIX);
}

/** The failure's text without its mark, for a toast that has an icon of its own. */
export function withoutErrorMark(text: string): string {
	return text.startsWith(ERROR_MARK) ? text.slice(ERROR_MARK.length).trimStart() : text;
}
