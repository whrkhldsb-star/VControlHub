/**
 * AI service — runtime layer.
 *
 * Owns the prisma `aiMessage` writes, the OpenAI/Anthropic/Google model
 * discovery, and the chat-completion proxy that adapts requests to each
 * provider's native wire format.
 *
 * Extracted from the previous `lib/ai/service.ts` god-file as part of R28.
 * CRUD paths live in `./service-crud`; DTO serializers in
 * `./service-serialize`; this module owns the request-time paths.
 */
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { defaultAiBaseUrl, fetchProviderModels, postProviderChat, trimProviderBaseUrl } from "./provider-http";

import { safeDecryptApiKey } from "./service-crud";
import { t } from "@/lib/i18n/service-translations";
import { assertImageOnlyAttachments, toAnthropicMessages } from "./anthropic-messages";

const DEFAULT_AI_BASE_URL = defaultAiBaseUrl();

/* ── Messages ───────────────────────────────────────────────── */

export async function createMessage(input: {
	conversationId: string;
	role: string;
	content: string;
	reasoningContent?: string;
	imageUrls?: string[];
	model?: string;
	inputTokens?: number;
	outputTokens?: number;
	latencyMs?: number;
}) {
	// A message is activity: the sidebar orders conversations by updatedAt,
	// which an insert into ai_messages does not touch on its own, so a
	// conversation picked up again stayed where it was (or off the list).
	const [message] = await prisma.$transaction([
		prisma.aiMessage.create({
		data: {
			conversationId: input.conversationId,
			role: input.role,
			content: input.content,
			reasoningContent: input.reasoningContent || null,
			imageUrls: JSON.stringify(input.imageUrls ?? []),
			model: input.model || null,
			inputTokens: input.inputTokens ?? null,
			outputTokens: input.outputTokens ?? null,
			latencyMs: input.latencyMs ?? null,
		},
		}),
		prisma.aiConversation.updateMany({ where: { id: input.conversationId }, data: { updatedAt: new Date() } }),
	]);
	return message;
}

/* ── Model discovery ─────────────────────────────────────────── */

export interface AiModelInfo {
	id: string;
	name: string;
	owned_by?: string;
	/** Whether this model supports vision/image input */
	vision?: boolean;
	/** Max context tokens if reported */
	context_length?: number;
	/** Detailed capabilities of the model */
	capabilities?: ModelCapabilities;
}

export interface ModelCapabilities {
	/** Can accept image inputs */
	vision: boolean;
	/** Can accept PDF/document files */
	document: boolean;
	/** Can accept video inputs */
	video: boolean;
	/** Can accept audio inputs */
	audio: boolean;
}

export async function fetchModelsFromCredentials(input: {
	apiKey: string;
	baseUrl?: string;
	defaultModel?: string;
	type?: string;
}): Promise<AiModelInfo[]> {
	if (!input.apiKey.trim()) throw new ValidationError(t("backend.ai.apiKeyCannotBeEmpty"));
	const baseUrl = trimProviderBaseUrl(input.baseUrl, DEFAULT_AI_BASE_URL);

	const rawModels = await fetchProviderModels({ apiKey: input.apiKey, baseUrl, type: input.type });
	const models = rawModels
		.map((m) => {
			const caps = detectModelCapabilities(m.id);
			return {
				id: m.id,
				name: m.name || m.id,
				owned_by: m.owned_by,
				vision: caps.vision,
				context_length: m.context_length,
				capabilities: caps,
			};
		})
		.sort((a, b) => a.id.localeCompare(b.id));

	return models;
}

export async function fetchModelsFromProvider(providerId: string, userId: string): Promise<AiModelInfo[]> {
	const provider = await prisma.aiProvider.findFirst({
		where: { id: providerId, createdBy: userId, enabled: true },
	});
	if (!provider) throw new NotFoundError(t("backend.ai.providerNotFoundOrDisabled"));

	const baseUrl = trimProviderBaseUrl(provider.baseUrl, DEFAULT_AI_BASE_URL);

	// Try the OpenAI-compatible /models endpoint
	const rawApiKey = safeDecryptApiKey(provider.apiKey);
	const rawModels: Array<{ id: string; name?: string; owned_by?: string; context_length?: number }> = [];
	try {
		rawModels.push(...(await fetchProviderModels({ apiKey: rawApiKey, baseUrl, type: provider.type })));
	} catch {
		// Fallback: return saved availableModels (tolerate corrupt JSON)
		let saved: string[] = [];
		try {
			const parsed: unknown = JSON.parse(provider.availableModels || "[]");
			if (Array.isArray(parsed)) {
				saved = parsed.filter((id): id is string => typeof id === "string");
			}
		} catch {
			saved = [];
		}
		if (saved.length > 0) {
			return saved.map((id) => {
				const caps = detectModelCapabilities(id);
				return { id, name: id, vision: caps.vision, capabilities: caps };
			});
		}
		// Last resort: return the default model
		const defCaps = detectModelCapabilities(provider.defaultModel);
		return [{ id: provider.defaultModel, name: provider.defaultModel, vision: defCaps.vision, capabilities: defCaps }];
	}

	// Sort by id and enrich with capability detection
	const models = rawModels
		.map((m) => {
			const caps = detectModelCapabilities(m.id);
			return {
				id: m.id,
				name: m.name || m.id,
				owned_by: m.owned_by,
				vision: caps.vision,
				context_length: m.context_length,
				capabilities: caps,
			};
		})
		.sort((a, b) => a.id.localeCompare(b.id));

	// Cache the model list back to provider — only over the configuration it
	// came from: a list fetched from the old endpoint, arriving after the
	// provider was saved with a new one, overwrote the new list.
	if (models.length > 0) {
		await prisma.aiProvider.updateMany({
			where: { id: providerId, updatedAt: provider.updatedAt },
			data: { availableModels: JSON.stringify(models.map((m) => m.id)) },
		});
	}

	return models.length > 0
		? models
		: (() => {
				const defCaps = detectModelCapabilities(provider.defaultModel);
				return [{ id: provider.defaultModel, name: provider.defaultModel, vision: defCaps.vision, capabilities: defCaps }];
			})();
}

/** Detect detailed capabilities of a model from its ID */
export function detectModelCapabilities(modelId: string): ModelCapabilities {
	const v = modelId.toLowerCase();

	// o1/o3/o4 vision: only specific variants support images
	const isO1Vision = v.includes("o1") && !v.includes("o1-mini") && !v.includes("o1-preview") && v.includes("o1-");
	const isO3Vision = v.includes("o3") && !v.includes("o3-mini");
	const isO4Vision = v.includes("o4");

	// Every Claude since Claude 3 reads images and PDFs, under either naming
	// scheme ("claude-3-5-sonnet", "claude-sonnet-4-5", "claude-opus-5-5"): the
	// list below only knew "claude-3"/"claude-4", so current models showed no
	// image support and attachments were refused.
	const modernClaude = /claude-(?:3|opus|sonnet|haiku|fable|mythos)/.test(v);

	// Vision: models that can accept images
	const vision =
		modernClaude ||
		v.includes("vision") ||
		v.includes("gpt-4o") ||
		v.includes("gpt-4-turbo") ||
		v.includes("gpt4-turbo") ||
		v.includes("gpt-4e") ||
		v.includes("claude-3") ||
		v.includes("claude-3.5") ||
		v.includes("claude-4") ||
		v.includes("gemini") ||
		v.includes("qwen-vl") ||
		v.includes("qwen2-vl") ||
		v.includes("qwen2.5-vl") ||
		v.includes("glm-4v") ||
		v.includes("llava") ||
		v.includes("internvl") ||
		v.includes("cogvlm") ||
		v.includes("minicpm-v") ||
		v.includes("pixtral") ||
		isO1Vision ||
		isO3Vision ||
		isO4Vision ||
		v.includes("deepseek-vl") ||
		v.includes("yi-vision");

	// Document: models that can parse PDF/docs natively
	const document =
		(modernClaude && !/claude-3-(?:opus|sonnet|haiku)/.test(v)) ||
		v.includes("gemini-1.5") ||
		v.includes("gemini-2") ||
		v.includes("gemini-pro") ||
		v.includes("claude-3.5-sonnet") ||
		v.includes("claude-3.5-haiku") ||
		v.includes("claude-4") ||
		v.includes("gpt-4o") ||
		isO1Vision ||
		isO3Vision ||
		isO4Vision;

	// Video: models that can process video frames
	const video =
		v.includes("gemini-1.5") ||
		v.includes("gemini-2") ||
		v.includes("gemini-pro") ||
		v.includes("qwen2-vl") ||
		v.includes("qwen2.5-vl") ||
		v.includes("gpt-4o") ||
		v.includes("claude-4");

	// Audio: models that can accept audio/speech input
	const audio =
		v.includes("gemini-2") ||
		v.includes("gpt-4o-audio") ||
		v.includes("gpt-4o-realtime") ||
		isO4Vision;

	return { vision, document, video, audio };
}

/* ── Chat Proxy ─────────────────────────────────────────────── */

/**
 * The sampling fields an Anthropic model accepts. Claude 4.7 and later (the
 * Claude 5 family included) answer any `temperature`/`top_p` with a 400, and
 * Opus 4.1 and the 4.5/4.6 models refuse the two together: always sending
 * both made every current Claude model fail. Claude 3 and 4.0 take both. A
 * model that is not named Claude (an Anthropic-compatible endpoint of another
 * vendor) keeps them as before.
 */
export function anthropicSamplingParams(model: string, temperature: number, topP: number): { temperature?: number; top_p?: number } {
	const id = model.toLowerCase();
	if (!id.includes("claude")) return { temperature, top_p: topP };
	if (/claude-3/.test(id)) return { temperature, top_p: topP };
	const named = /claude-(?:opus|sonnet|haiku)-(\d+)(?:-(\d{1,2})(?!\d))?/.exec(id);
	if (named && Number(named[1]) === 4) {
		const minor = Number(named[2] ?? 0);
		if (minor === 0) return { temperature, top_p: topP };
		if (minor <= 6) return { temperature };
	}
	return {};
}

export interface ChatCompletionRequest {
	providerId: string;
	model: string;
	messages: Array<{
		role: "user" | "assistant" | "system" | "tool";
		content: string | Array<{ type: "text" | "image_url"; text?: string; image_url?: { url: string } }>;
		tool_call_id?: string; // for role=tool
		tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>; // for role=assistant
	}>;
	temperature?: number;
	max_tokens?: number;
	top_p?: number;
	frequency_penalty?: number;
	presence_penalty?: number;
	stream?: boolean;
	tools?: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
	/** Extra provider-specific body fields (e.g. Anthropic "max_tokens") */
	extraBody?: Record<string, unknown>;
}

export async function sendChatRequest(req: ChatCompletionRequest, userId: string, signal?: AbortSignal) {
	signal?.throwIfAborted();
	const provider = await prisma.aiProvider.findFirst({
		where: { id: req.providerId, createdBy: userId, enabled: true },
	});
	if (!provider) throw new NotFoundError(t("backend.ai.providerNotFoundOrDisabled"));

	const rawApiKey = safeDecryptApiKey(provider.apiKey);
	const baseUrl = provider.baseUrl.replace(/\/+$/, "");
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	let url: string;
	let body: Record<string, unknown>;

	if (provider.type === "ANTHROPIC") {
		// ── Anthropic Messages API ──
		// https://docs.anthropic.com/en/api/messages
		url = `${baseUrl}/messages`;
		headers["x-api-key"] = rawApiKey;
		headers["anthropic-version"] = "2023-06-01";

		// Anthropic takes the system prompt as one field. Join every system
		// message in order: taking the first dropped the conversation's own
		// prompt whenever plan mode put its instructions ahead of it.
		const systemText = req.messages
			.filter((m) => m.role === "system" && typeof m.content === "string" && m.content.trim())
			.map((m) => m.content as string)
			.join("\n\n");
		const chatMessages = req.messages.filter((m) => m.role !== "system");

		// Tool calls, tool results and PDFs in the Messages API's own shape.
		const anthropicMessages = toAnthropicMessages(chatMessages, { nativeTools: Boolean(req.tools && req.tools.length > 0) });

		body = {
			model: req.model,
			messages: anthropicMessages,
			...(systemText && { system: systemText }),
			max_tokens: req.max_tokens ?? 4096,
			...anthropicSamplingParams(req.model, req.temperature ?? 0.7, req.top_p ?? 1.0),
			stream: req.stream ?? true,
			...(req.tools && req.tools.length > 0 && {
				tools: req.tools.map((t) => ({
					name: t.function.name,
					description: t.function.description,
					input_schema: t.function.parameters,
				})),
			}),
		};
	} else if (provider.type === "GOOGLE") {
		// ── Google Gemini API ──
		// Use OpenAI-compatible proxy if available; otherwise native format
		url = `${baseUrl}/chat/completions`;
		headers["Authorization"] = `Bearer ${rawApiKey}`;
		assertImageOnlyAttachments(req.messages);
		body = {
			model: req.model,
			messages: req.messages,
			temperature: req.temperature ?? 0.7,
			max_tokens: req.max_tokens ?? 4096,
			top_p: req.top_p ?? 1.0,
			stream: req.stream ?? true,
			// The OpenAI-compatible endpoint takes function tools as the others do;
			// without them hosting could never call one through Gemini.
			...(req.tools && req.tools.length > 0 && { tools: req.tools }),
		};
	} else {
		// ── OpenAI / OpenAI-Compatible ──
		url = `${baseUrl}/chat/completions`;
		headers["Authorization"] = `Bearer ${rawApiKey}`;
		assertImageOnlyAttachments(req.messages);
		const streaming = req.stream ?? true;
		// OpenAI's own endpoint: the o-series and GPT-5 refuse `max_tokens` (they take `max_completion_tokens`) and the
		// sampling parameters (the o-series only accepts the default temperature), so every chat with the recommended
		// o3-mini was an HTTP 400; and a streamed reply carries no `usage` unless asked for, which recorded 0 tokens.
		const officialReasoningModel = provider.type === "OPENAI" && /^(o\d|gpt-5)/i.test(req.model);
		body = {
			model: req.model,
			messages: req.messages,
			...(officialReasoningModel
				? { max_completion_tokens: req.max_tokens ?? 4096 }
				: {
						temperature: req.temperature ?? 0.7,
						max_tokens: req.max_tokens ?? 4096,
						top_p: req.top_p ?? 1.0,
						frequency_penalty: req.frequency_penalty ?? 0.0,
						presence_penalty: req.presence_penalty ?? 0.0,
					}),
			stream: streaming,
			...(streaming && provider.type === "OPENAI" ? { stream_options: { include_usage: true } } : {}),
			...(req.tools && req.tools.length > 0 && { tools: req.tools }),
			...(req.extraBody || {}),
		};
	}

	const startTime = Date.now();
	const response = await postProviderChat({
		url,
		body,
		headers,
		signal,
	});

	return { response, startTime, providerType: provider.type };
}
