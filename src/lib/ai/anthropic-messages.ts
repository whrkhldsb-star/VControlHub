import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

import type { ChatCompletionRequest } from "./service-runtime";

type ChatMessage = ChatCompletionRequest["messages"][number];
type AnthropicBlock = Record<string, unknown>;
export type AnthropicMessage = { role: "user" | "assistant"; content: AnthropicBlock[] };

const DATA_URL = /^data:([^;,]+);base64,([\s\S]+)$/;

/** Media an attachment carries as a data URL (null for a plain http(s) image URL). */
export function dataUrlMediaType(url: string): string | null {
	return DATA_URL.exec(url)?.[1]?.toLowerCase() ?? null;
}

/**
 * Attachments the OpenAI-style providers get as `image_url` parts: images
 * only. A PDF, audio or video data URL in an `image_url` part is not a
 * format they read, so it is refused here instead of being sent wrongly.
 */
export function assertImageOnlyAttachments(messages: ChatMessage[]): void {
	for (const message of messages) {
		if (typeof message.content === "string") continue;
		for (const part of message.content) {
			if (part.type !== "image_url" || !part.image_url) continue;
			const media = dataUrlMediaType(part.image_url.url);
			if (media && !media.startsWith("image/")) {
				throw new ValidationError(t("backend.ai.attachmentImagesOnly", { media }));
			}
		}
	}
}

function contentBlocks(content: ChatMessage["content"]): AnthropicBlock[] {
	if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
	const blocks: AnthropicBlock[] = [];
	for (const part of content) {
		if (part.type === "text") {
			if (part.text) blocks.push({ type: "text", text: part.text });
			continue;
		}
		if (part.type !== "image_url" || !part.image_url) continue;
		const url = part.image_url.url;
		const match = DATA_URL.exec(url);
		if (!match) {
			blocks.push({ type: "image", source: { type: "url", url } });
			continue;
		}
		const mediaType = match[1]!.toLowerCase();
		const source = { type: "base64", media_type: mediaType, data: match[2] };
		if (mediaType === "application/pdf") blocks.push({ type: "document", source });
		else if (mediaType.startsWith("image/")) blocks.push({ type: "image", source });
		else throw new ValidationError(t("backend.ai.attachmentAnthropicUnsupported", { media: mediaType }));
	}
	return blocks;
}

function parseToolInput(argumentsJson: string): unknown {
	try {
		const parsed = JSON.parse(argumentsJson || "{}") as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

/**
 * The OpenAI-style history in the Messages API's own shape: an assistant's
 * `tool_calls` become `tool_use` blocks, each `role: "tool"` result a
 * `tool_result` block in a user turn (Anthropic has no tool role), PDFs
 * `document` blocks. Consecutive turns of one role are merged, as the API
 * requires alternation (several tool results answer one assistant turn).
 *
 * `nativeTools: false` (a request that defines no tools) writes the calls
 * and results as text instead: the API refuses tool_use and tool_result
 * blocks in a request without tool definitions, which failed the answer
 * after hosted tools ran and every later turn once hosting was switched off.
 */
export function toAnthropicMessages(messages: ChatMessage[], options: { nativeTools?: boolean } = {}): AnthropicMessage[] {
	const nativeTools = options.nativeTools ?? true;
	const toolNames = new Map<string, string>();
	const out: AnthropicMessage[] = [];
	const push = (role: AnthropicMessage["role"], blocks: AnthropicBlock[]) => {
		if (blocks.length === 0) return;
		const last = out[out.length - 1];
		if (last && last.role === role) last.content.push(...blocks);
		else out.push({ role, content: blocks });
	};
	for (const message of messages) {
		if (message.role === "system") continue;
		if (message.role === "tool") {
			if (!nativeTools) {
				const label = `[Result of ${toolNames.get(message.tool_call_id ?? "") ?? "tool"}]`;
				push("user", typeof message.content === "string"
					? [{ type: "text", text: `${label}\n${message.content}` }]
					: [{ type: "text", text: label }, ...contentBlocks(message.content)]);
				continue;
			}
			push("user", [{
				type: "tool_result",
				tool_use_id: message.tool_call_id ?? "",
				content: typeof message.content === "string" ? message.content : contentBlocks(message.content),
			}]);
			continue;
		}
		if (message.role === "assistant") {
			const calls = message.tool_calls ?? [];
			for (const call of calls) toolNames.set(call.id, call.function.name);
			const toolUses = nativeTools
				? calls.map((call) => ({
					type: "tool_use",
					id: call.id,
					name: call.function.name,
					input: parseToolInput(call.function.arguments),
				}))
				: calls.map((call) => ({ type: "text", text: `[Called ${call.function.name} ${call.function.arguments || "{}"}]` }));
			push("assistant", [...contentBlocks(message.content), ...toolUses]);
			continue;
		}
		push("user", contentBlocks(message.content));
	}
	return out;
}
