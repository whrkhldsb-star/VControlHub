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
import { defaultAiBaseUrl, fetchProviderModels, postProviderChat, trimProviderBaseUrl } from "./provider-http";

import { safeDecryptApiKey } from "./service-crud";

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
	return prisma.aiMessage.create({
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
	});
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
}): Promise<AiModelInfo[]> {
	if (!input.apiKey.trim()) throw new Error("API Key 不能为空");
	const baseUrl = trimProviderBaseUrl(input.baseUrl, DEFAULT_AI_BASE_URL);
	const fallbackModel = input.defaultModel?.trim() || "gpt-4o";

	const rawModels = await fetchProviderModels({ apiKey: input.apiKey, baseUrl });
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

	if (models.length > 0) return models;
	const fallbackCaps = detectModelCapabilities(fallbackModel);
	return [{ id: fallbackModel, name: fallbackModel, vision: fallbackCaps.vision, capabilities: fallbackCaps }];
}

export async function fetchModelsFromProvider(providerId: string, userId: string): Promise<AiModelInfo[]> {
	const provider = await prisma.aiProvider.findFirst({
		where: { id: providerId, createdBy: userId, enabled: true },
	});
	if (!provider) throw new Error("提供商不存在或已禁用");

	const baseUrl = trimProviderBaseUrl(provider.baseUrl, DEFAULT_AI_BASE_URL);

	// Try the OpenAI-compatible /models endpoint
	const rawApiKey = safeDecryptApiKey(provider.apiKey);
	const rawModels: Array<{ id: string; name?: string; owned_by?: string; context_length?: number }> = [];
	try {
		rawModels.push(...(await fetchProviderModels({ apiKey: rawApiKey, baseUrl })));
	} catch {
		// Fallback: return saved availableModels
		const saved: string[] = JSON.parse(provider.availableModels || "[]");
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

	// Cache the model list back to provider
	if (models.length > 0) {
		await prisma.aiProvider.update({
			where: { id: providerId },
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

	// Vision: models that can accept images
	const vision =
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

export async function sendChatRequest(req: ChatCompletionRequest, userId: string) {
	const provider = await prisma.aiProvider.findFirst({
		where: { id: req.providerId, createdBy: userId, enabled: true },
	});
	if (!provider) throw new Error("提供商不存在或已禁用");

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

		// Extract system prompt from messages (Anthropic sends it separately)
		const systemMsg = req.messages.find((m) => m.role === "system");
		const chatMessages = req.messages.filter((m) => m.role !== "system");

		// Convert OpenAI-style content parts to Anthropic format
		const anthropicMessages = chatMessages.map((m) => {
			if (typeof m.content === "string") {
				return { role: m.role, content: m.content };
			}
			// Multimodal: convert image_url → Anthropic image blocks
			const parts: Array<{ type: string; text?: string; source?: Record<string, unknown> }> = [];
			for (const part of m.content as Array<{ type: string; text?: string; image_url?: { url: string } }>) {
				if (part.type === "text") {
					parts.push({ type: "text", text: part.text });
				} else if (part.type === "image_url" && part.image_url) {
					const imgSrc = part.image_url.url;
					if (imgSrc.startsWith("data:")) {
						// data:image/png;base64,xxxx → extract
						const match = imgSrc.match(/^data:([^;]+);base64,(.+)$/);
						if (match) {
							parts.push({
								type: "image",
								source: { type: "base64", media_type: match[1], data: match[2] },
							});
						}
					} else {
						parts.push({
							type: "image",
							source: { type: "url", url: imgSrc },
						});
					}
				}
			}
			return { role: m.role, content: parts };
		});

		body = {
			model: req.model,
			messages: anthropicMessages,
			...(systemMsg && { system: typeof systemMsg.content === "string" ? systemMsg.content : "" }),
			max_tokens: req.max_tokens ?? 4096,
			temperature: req.temperature ?? 0.7,
			top_p: req.top_p ?? 1.0,
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
		body = {
			model: req.model,
			messages: req.messages,
			temperature: req.temperature ?? 0.7,
			max_tokens: req.max_tokens ?? 4096,
			top_p: req.top_p ?? 1.0,
			stream: req.stream ?? true,
		};
	} else {
		// ── OpenAI / OpenAI-Compatible ──
		url = `${baseUrl}/chat/completions`;
		headers["Authorization"] = `Bearer ${rawApiKey}`;
		body = {
			model: req.model,
			messages: req.messages,
			temperature: req.temperature ?? 0.7,
			max_tokens: req.max_tokens ?? 4096,
			top_p: req.top_p ?? 1.0,
			frequency_penalty: req.frequency_penalty ?? 0.0,
			presence_penalty: req.presence_penalty ?? 0.0,
			stream: req.stream ?? true,
			...(req.tools && req.tools.length > 0 && { tools: req.tools }),
			...(req.extraBody || {}),
		};
	}

	const startTime = Date.now();
	const response = await postProviderChat({
		url,
		body,
		headers,
	});

	return { response, startTime, providerType: provider.type };
}
