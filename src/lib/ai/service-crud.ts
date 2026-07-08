/**
 * AI service — CRUD layer for AI providers and conversations.
 *
 * Extracted from the previous `lib/ai/service.ts` god-file as part of R28.
 * The runtime functions (model-fetching, chat-completion) live in
 * `./service-runtime`; DTO serializers in `./service-serialize`; this
 * module owns the prisma CRUD paths plus the input types.
 */
import { prisma } from "@/lib/db";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/service";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { getAiConversationListLimit, getAiProviderListLimit } from "@/lib/runtime-settings/service";
import { normalizePublicHttpUrl } from "@/lib/storage/direct-access-url";
import { defaultAiBaseUrl } from "./provider-http";

const DEFAULT_AI_BASE_URL = defaultAiBaseUrl();

/* ── Helpers ─────────────────────────────────────────────────── */

export function safeDecryptApiKey(stored: string): string {
	try {
		return isEncrypted(stored) ? decrypt(stored) : stored;
	} catch {
		return stored;
	}
}

function normalizeProviderModels(models?: string[]) {
	return Array.from(
		new Set((models ?? []).map((model) => model.trim()).filter(Boolean)),
	);
}

export function normalizeProviderBaseUrl(value: string | undefined) {
	return normalizePublicHttpUrl(value?.trim() || DEFAULT_AI_BASE_URL);
}

/* ── Types ───────────────────────────────────────────────────── */

export interface CreateProviderInput {
	name: string;
	type?: string;
	apiKey: string;
	baseUrl?: string;
	defaultModel?: string;
	availableModels?: string[];
	isDefault?: boolean;
	enabled?: boolean;
	settings?: Record<string, unknown>;
	createdBy: string;
}

export interface UpdateProviderInput {
	name?: string;
	type?: string;
	apiKey?: string;
	baseUrl?: string;
	defaultModel?: string;
	availableModels?: string[];
	isDefault?: boolean;
	enabled?: boolean;
	settings?: Record<string, unknown>;
}

export interface CreateConversationInput {
	title?: string;
	providerId: string;
	model: string;
	systemPrompt?: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	enableVision?: boolean;
	hostingEnabled?: boolean;
	createdBy: string;
}

export interface UpdateConversationInput {
	title?: string;
	model?: string;
	systemPrompt?: string;
	temperature?: number;
	maxTokens?: number;
	topP?: number;
	frequencyPenalty?: number;
	presencePenalty?: number;
	enableVision?: boolean;
	hostingEnabled?: boolean;
}

/* ── Provider CRUD ───────────────────────────────────────────── */

const AI_PROVIDER_LIST_SELECT = {
	id: true,
	name: true,
	type: true,
	apiKey: true,
	baseUrl: true,
	defaultModel: true,
	availableModels: true,
	isDefault: true,
	enabled: true,
	settings: true,
	createdAt: true,
	updatedAt: true,
} as const;

/* ── Provider CRUD ───────────────────────────────────────────── */

export async function createProvider(input: CreateProviderInput) {
	if (!input.name.trim()) throw new ValidationError("Provider name is required");
	if (!input.apiKey.trim()) throw new ValidationError("API Key is required");

	const normalizedBaseUrl = normalizeProviderBaseUrl(input.baseUrl);
	const normalizedModels = normalizeProviderModels(input.availableModels);
	const encryptedKey = encrypt(input.apiKey.trim());

	if (input.isDefault) {
		await prisma.aiProvider.updateMany({
			where: { isDefault: true, createdBy: input.createdBy },
			data: { isDefault: false },
		});
	}

	return prisma.aiProvider.create({
		data: {
			name: input.name.trim(),
			type: (input.type as "OPENAI_COMPATIBLE") || "OPENAI_COMPATIBLE",
			apiKey: encryptedKey,
			baseUrl: normalizedBaseUrl,
			defaultModel: input.defaultModel?.trim() || "gpt-4o",
			availableModels: JSON.stringify(normalizedModels),
			isDefault: input.isDefault ?? false,
			enabled: input.enabled ?? true,
			settings: input.settings ? (input.settings as object) : undefined,
			createdBy: input.createdBy,
		},
		select: AI_PROVIDER_LIST_SELECT,
	});
}

export async function listProviders(userId: string) {
	const limit = await getAiProviderListLimit();
	return prisma.aiProvider.findMany({
		where: { createdBy: userId },
		orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
		take: limit,
		select: AI_PROVIDER_LIST_SELECT,
	});
}

export async function getProviderById(id: string, userId: string) {
	const provider = await prisma.aiProvider.findFirst({
		where: { id, createdBy: userId },
		select: AI_PROVIDER_LIST_SELECT,
	});
	if (!provider) throw new NotFoundError("Provider not found");
	return provider;
}

export async function updateProvider(id: string, userId: string, input: UpdateProviderInput) {
	const data: Record<string, unknown> = {};
	if (input.name !== undefined) data.name = input.name.trim();
	if (input.type !== undefined) data.type = input.type.trim();
	if (input.apiKey !== undefined) data.apiKey = encrypt(input.apiKey.trim());
	if (input.baseUrl !== undefined) data.baseUrl = normalizeProviderBaseUrl(input.baseUrl);
	if (input.defaultModel !== undefined) data.defaultModel = input.defaultModel.trim() || null;
	if (input.availableModels !== undefined) {
		data.availableModels = JSON.stringify(normalizeProviderModels(input.availableModels));
	}
	if (input.isDefault !== undefined) data.isDefault = input.isDefault;
	if (input.enabled !== undefined) data.enabled = input.enabled;
	if (input.settings !== undefined) data.settings = input.settings;

	if (input.isDefault === true) {
		await prisma.aiProvider.updateMany({
			where: { isDefault: true, createdBy: userId, NOT: { id } },
			data: { isDefault: false },
		});
	}

	const updated = await prisma.aiProvider.updateMany({
		where: { id, createdBy: userId },
		data,
	});
	if (updated.count === 0) throw new NotFoundError("Provider not found");
	return prisma.aiProvider.findUnique({ where: { id }, select: AI_PROVIDER_LIST_SELECT });
}

export async function deleteProvider(id: string, userId: string) {
	const deleted = await prisma.aiProvider.deleteMany({ where: { id, createdBy: userId } });
	if (deleted.count === 0) throw new NotFoundError("Provider not found");
}

/* ── Conversation CRUD ───────────────────────────────────────── */

export async function createConversation(input: CreateConversationInput) {
	const provider = await prisma.aiProvider.findUnique({ where: { id: input.providerId } });
	if (!provider) throw new NotFoundError("AI provider not found");

	return prisma.aiConversation.create({
		data: {
			title: input.title?.trim() || "New conversation",
			providerId: input.providerId,
			model: input.model,
			systemPrompt: input.systemPrompt ?? null,
			temperature: input.temperature,
			maxTokens: input.maxTokens,
			topP: input.topP,
			frequencyPenalty: input.frequencyPenalty,
			presencePenalty: input.presencePenalty,
			enableVision: input.enableVision ?? false,
			hostingEnabled: input.hostingEnabled ?? false,
			createdBy: input.createdBy,
		},
		include: { provider: true },
	});
}

export async function listConversations(userId: string) {
	const limit = await getAiConversationListLimit();
	return prisma.aiConversation.findMany({
		where: { createdBy: userId },
		orderBy: { updatedAt: "desc" },
		take: limit,
		include: { provider: { select: { id: true, name: true, type: true } } },
	});
}

export async function getConversationById(id: string, userId: string) {
	const conv = await prisma.aiConversation.findFirst({
		where: { id, createdBy: userId },
		include: {
			provider: true,
			messages: { orderBy: { createdAt: "asc" } },
		},
	});
	if (!conv) throw new NotFoundError("Conversation not found");
	return conv;
}

export async function updateConversation(id: string, userId: string, input: UpdateConversationInput) {
	const data: Record<string, unknown> = {};
	if (input.title !== undefined) data.title = input.title.trim();
	if (input.model !== undefined) data.model = input.model;
	if (input.systemPrompt !== undefined) data.systemPrompt = input.systemPrompt;
	if (input.temperature !== undefined) data.temperature = input.temperature;
	if (input.maxTokens !== undefined) data.maxTokens = input.maxTokens;
	if (input.topP !== undefined) data.topP = input.topP;
	if (input.frequencyPenalty !== undefined) data.frequencyPenalty = input.frequencyPenalty;
	if (input.presencePenalty !== undefined) data.presencePenalty = input.presencePenalty;
	if (input.enableVision !== undefined) data.enableVision = input.enableVision;
	if (input.hostingEnabled !== undefined) data.hostingEnabled = input.hostingEnabled;

	const updated = await prisma.aiConversation.updateMany({
		where: { id, createdBy: userId },
		data,
	});
	if (updated.count === 0) throw new NotFoundError("Conversation not found");
	return prisma.aiConversation.findUnique({ where: { id }, include: { provider: true } });
}

export async function deleteConversation(id: string, userId: string) {
	await prisma.aiConversation.delete({ where: { id, createdBy: userId } });
}

export async function clearConversationMessages(id: string, userId: string) {
	const conv = await prisma.aiConversation.findFirst({ where: { id, createdBy: userId } });
	if (!conv) throw new NotFoundError("Conversation not found");
	await prisma.aiMessage.deleteMany({ where: { conversationId: id } });
}
