import type { Message } from "./ai-types";
import { randomId } from "@/lib/ui/random-id";

/**
 * The reply written into the transcript when a request fails.
 *
 * It exists in the page only (the server keeps no message for a failed turn), so it is told by its id and not
 * by its text: an answer may begin with any character, a cross mark included. The bubble draws its own warning
 * icon and colours; the text used to begin with a "❌" as well, which each system draws its own way.
 */
const STREAM_ERROR_ID_PREFIX = "stream-error-";

export function streamErrorMessage({ conversationId, text, model }: { conversationId: string; text: string; model: string | null }): Message {
	return {
		id: `${STREAM_ERROR_ID_PREFIX}${randomId()}`,
		conversationId,
		role: "assistant",
		content: text,
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
