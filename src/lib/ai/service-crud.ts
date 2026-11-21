/**
 * AI service — CRUD layer for AI providers and conversations.
 *
 * Extracted from the previous `lib/ai/service.ts` god-file as part of R28.
 * The runtime functions (model-fetching, chat-completion) live in
 * `./service-runtime`; DTO serializers in `./service-serialize`; this
 * module owns the prisma CRUD paths plus the input types.
 */
import { isUniqueViolation, prisma } from "@/lib/db";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/service";
import { BusinessError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { seesAllCustomers, type TeamSession } from "@/lib/auth/team-scope";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { getAiConversationListLimit, getAiProviderListLimit } from "@/lib/runtime-settings/service";
import { normalizePublicHttpUrl } from "@/lib/storage/direct-access-url";
import { isLinkLocalAddress } from "@/lib/security/pinned-fetch";
import { aiProviderTypeSchema, type AiProviderType } from "./schema";
import { resolveDefaultProviderBaseUrl, isListedPrivateProviderHost, providerApiRoot } from "./provider-http";

import { providerEndpointChanged } from "./provider-endpoint";

/* ── Helpers ─────────────────────────────────────────────────── */

/**
 * The provider's API key as it is sent to the provider. A stored key that cannot be decrypted (the encryption key
 * changed, the row was damaged) is reported, not sent as it is: the ciphertext went out as the API key before.
 */
export function safeDecryptApiKey(stored: string): string {
	if (!isEncrypted(stored)) return stored;
	try {
		return decrypt(stored);
	} catch {
		throw new BusinessError(t("backend.ai.providerKeyUnreadable"));
	}
}

function normalizeProviderModels(models?: string[]) {
	return Array.from(
		new Set((models ?? []).map((model) => model.trim()).filter(Boolean)),
	);
}

export function normalizeProviderBaseUrl(value: string | undefined, type?: string) {
	const raw = value?.trim() || resolveDefaultProviderBaseUrl(type);
	providerApiRoot(raw, type);
	// A host the operator listed in AI_PROVIDER_PRIVATE_HOSTS may be a private or loopback address
	// ("http://192.168.1.20:11434/v1"); the scheme and credential rules still apply, link-local never passes.
	if (isListedPrivateProviderHost(raw)) {
		const url = new URL(raw);
		if (url.protocol !== "https:" && url.protocol !== "http:") throw new ValidationError(t("backend.ai.aiProviderUrlMustUseHttpS"));
		if (url.username || url.password) throw new ValidationError(t("backend.ai.aiProviderUrlMustNotContainCredentials"));
		if (isLinkLocalAddress(url.hostname)) throw new ValidationError(t("backend.ai.aiProviderUrlMustNotPointToA"));
		url.hash = "";
		return url.toString();
	}
	return normalizePublicHttpUrl(raw);
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
	automationMode?: "ASSISTED" | "PLAN_ONLY";
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
	automationMode?: "ASSISTED" | "PLAN_ONLY";
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

function resolveProviderType(raw: string | undefined): AiProviderType {
	if (raw === undefined || raw.trim() === "") return "OPENAI_COMPATIBLE";
	const parsed = aiProviderTypeSchema.safeParse(raw.trim());
	if (!parsed.success) {
		throw new ValidationError(t("backend.ai.invalidProviderType"));
	}
	return parsed.data;
}

export async function createProvider(input: CreateProviderInput) {
	if (!input.name.trim()) throw new ValidationError(t("backend.ai.providerNameIsRequired"));
	if (!input.apiKey.trim()) throw new ValidationError(t("backend.ai.apiKeyIsRequired"));

	const providerType = resolveProviderType(input.type);
	const normalizedBaseUrl = normalizeProviderBaseUrl(input.baseUrl, providerType);
	const normalizedModels = normalizeProviderModels(input.availableModels);
	const encryptedKey = encrypt(input.apiKey.trim());

	// The default moves in the same transaction as the write: a create
	// refused for a name the user already has used to leave them with no
	// default provider at all.
	return withProviderNameCheck(() => prisma.$transaction(async (tx) => {
		if (input.isDefault) {
			// Two concurrent "new default" creates each clear the defaults they
			// can see, then insert: both rows would stay default.
			await lockForTransaction(tx, "ai-provider-default", input.createdBy);
			await tx.aiProvider.updateMany({
				where: { isDefault: true, createdBy: input.createdBy },
				data: { isDefault: false },
			});
		}

		return tx.aiProvider.create({
			data: {
				name: input.name.trim(),
				type: providerType,
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
	}));
}

/** Provider names are unique per user; say so instead of a database error. */
async function withProviderNameCheck<T>(write: () => Promise<T>): Promise<T> {
	try {
		return await write();
	} catch (error) {
		if (isUniqueViolation(error)) throw new ValidationError(t("backend.ai.providerNameTaken"));
		throw error;
	}
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
	if (!provider) throw new NotFoundError(t("backend.ai.providerNotFound"));
	return provider;
}

export async function updateProvider(id: string, userId: string, input: UpdateProviderInput) {
	const data: Record<string, unknown> = {};
	if (input.name !== undefined) data.name = input.name.trim();
	const newType = input.type === undefined ? undefined : resolveProviderType(input.type);
	if (newType) data.type = newType;
	if (input.apiKey !== undefined) {
		if (!input.apiKey.trim()) throw new ValidationError(t("backend.ai.apiKeyIsRequired"));
		data.apiKey = encrypt(input.apiKey.trim());
	}
	// An empty model is not a choice: switching the provider type cleared it and
	// every new conversation then failed with 400 (A7-06).
	if (input.defaultModel !== undefined && input.defaultModel.trim()) data.defaultModel = input.defaultModel.trim();
	if (input.availableModels !== undefined) {
		data.availableModels = JSON.stringify(normalizeProviderModels(input.availableModels));
	}
	if (input.isDefault !== undefined) data.isDefault = input.isDefault;
	if (input.enabled !== undefined) data.enabled = input.enabled;
	if (input.settings !== undefined) data.settings = input.settings;

	// One transaction: an update that fails (unknown id, a name the user
	// already has) must not have cleared their default provider first.
	return withProviderNameCheck(() => prisma.$transaction(async (tx) => {
		if (input.isDefault === true) {
			await lockForTransaction(tx, "ai-provider-default", userId);
			await tx.aiProvider.updateMany({
				where: { isDefault: true, createdBy: userId, NOT: { id } },
				data: { isDefault: false },
			});
		}

		// The update must still see the endpoint we compared. Without the predicate
		// a concurrent rotation can pair a new key with a different origin.
		let endpointGuard = {};
		if (newType || input.baseUrl !== undefined || input.apiKey !== undefined) {
			const current = await tx.aiProvider.findFirst({
				where: { id, createdBy: userId }, select: { type: true, baseUrl: true },
			});
			if (!current) throw new NotFoundError(t("backend.ai.providerNotFound"));
			const nextType = newType ?? current.type;
			const typeChanged = nextType !== current.type;
			const nextBaseUrl = normalizeProviderBaseUrl(input.baseUrl ?? (typeChanged ? undefined : current.baseUrl), nextType);
			if (providerEndpointChanged(current, { type: nextType, baseUrl: nextBaseUrl }) && !input.apiKey?.trim()) {
				throw new ValidationError(t("backend.ai.providerKeyForNewEndpoint"));
			}
			data.baseUrl = nextBaseUrl;
			endpointGuard = { type: current.type, baseUrl: current.baseUrl };
		}
		const updated = await tx.aiProvider.updateMany({
			where: { id, createdBy: userId, ...endpointGuard },
			data,
		});
		if (updated.count === 0) throw new NotFoundError(t("backend.ai.providerNotFound"));
		return tx.aiProvider.findUnique({ where: { id }, select: AI_PROVIDER_LIST_SELECT });
	}));
}

export async function deleteProvider(id: string, userId: string) {
	const deleted = await prisma.aiProvider.deleteMany({ where: { id, createdBy: userId } });
	if (deleted.count === 0) throw new NotFoundError(t("backend.ai.providerNotFound"));
}

/* ── Conversation CRUD ───────────────────────────────────────── */

function conversationOwnerWhere(session: TeamSession) {
	if (!session.currentTeamId && !seesAllCustomers(session)) {
		throw new ForbiddenError(t("backend.team.activeTeamRequired"));
	}
	return { createdBy: session.userId, teamId: session.currentTeamId ?? null };
}

export async function createConversation(input: CreateConversationInput, session: TeamSession) {
	const owner = conversationOwnerWhere(session);
	// Ownership gate: never allow binding another user's provider (IDOR + secret exposure).
	const provider = await prisma.aiProvider.findFirst({
		where: { id: input.providerId, createdBy: session.userId },
	});
	if (!provider) throw new NotFoundError(t("backend.ai.aiProviderNotFound"));

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
			automationMode: input.automationMode ?? "ASSISTED",
			...owner,
		},
		// Never include provider.apiKey ciphertext on conversation create responses.
		include: {
			provider: {
				select: {
					id: true,
					name: true,
					type: true,
					baseUrl: true,
					defaultModel: true,
					availableModels: true,
					isDefault: true,
					enabled: true,
					createdAt: true,
					updatedAt: true,
				},
			},
		},
	});
}

export async function listConversations(session: TeamSession) {
	if (!session.currentTeamId && !seesAllCustomers(session)) return [];
	const limit = await getAiConversationListLimit();
	return prisma.aiConversation.findMany({
		where: conversationOwnerWhere(session),
		orderBy: { updatedAt: "desc" },
		take: limit,
		include: { provider: { select: { id: true, name: true, type: true } } },
	});
}

export async function getConversationById(id: string, session: TeamSession) {
	// Cap message payload size for long threads (chat path loads conversation often).
	const MESSAGE_TAKE = 500;
	const conv = await prisma.aiConversation.findFirst({
		where: { id, ...conversationOwnerWhere(session) },
		include: {
			// Exclude apiKey ciphertext from API-facing conversation payloads.
			provider: {
				select: {
					id: true,
					name: true,
					type: true,
					baseUrl: true,
					defaultModel: true,
					availableModels: true,
					isDefault: true,
					enabled: true,
					settings: true,
					createdBy: true,
					createdAt: true,
					updatedAt: true,
				},
			},
			// Latest window first, then reverse to chronological for UI. The id
			// orders turns written within one millisecond (an assistant turn and
			// its tool results): by createdAt alone a result could precede its
			// call, be dropped from the history, and leave the call unanswered.
			messages: {
				orderBy: [{ createdAt: "desc" }, { id: "desc" }],
				take: MESSAGE_TAKE,
				include: {
					hostedActions: {
						orderBy: { createdAt: "asc" },
						select: {
							id: true,
							conversationId: true,
							messageId: true,
							toolCallId: true,
							serverId: true,
							actionType: true,
							actionName: true,
							params: true,
							status: true,
							riskLevel: true,
							autoApproved: true,
							result: true,
							errorMessage: true,
							createdAt: true,
							approvedAt: true,
							executedAt: true,
							completedAt: true,
							server: {
								select: { id: true, name: true, host: true },
							},
						},
					},
				},
			},
		},
	});
	if (!conv) throw new NotFoundError(t("backend.ai.conversationNotFound"));
	return { ...conv, messages: [...conv.messages].reverse() };
}

export async function updateConversation(id: string, session: TeamSession, input: UpdateConversationInput) {
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
	if (input.automationMode !== undefined) data.automationMode = input.automationMode;

	const updated = await prisma.aiConversation.updateMany({
		where: { id, ...conversationOwnerWhere(session) },
		data,
	});
	if (updated.count === 0) throw new NotFoundError(t("backend.ai.conversationNotFound"));
	return prisma.aiConversation.findFirst({
		where: { id, ...conversationOwnerWhere(session) },
		include: {
			provider: {
				select: {
					id: true,
					name: true,
					type: true,
					baseUrl: true,
					defaultModel: true,
					availableModels: true,
					isDefault: true,
					enabled: true,
					createdAt: true,
					updatedAt: true,
				},
			},
		},
	});
}

export async function deleteConversation(id: string, session: TeamSession) {
	// The database cascades the same scoped deletion to messages and action cards.
	const deleted = await prisma.aiConversation.deleteMany({ where: { id, ...conversationOwnerWhere(session) } });
	if (!deleted.count) throw new NotFoundError(t("backend.ai.conversationNotFound"));
}

export async function clearConversationMessages(id: string, session: TeamSession) {
	const owner = conversationOwnerWhere(session);
	const conv = await prisma.aiConversation.findFirst({ where: { id, ...owner }, select: { id: true } });
	if (!conv) throw new NotFoundError(t("backend.ai.conversationNotFound"));
	await prisma.$transaction([
		prisma.aiHostedAction.deleteMany({ where: { conversationId: id, conversation: owner } }),
		prisma.aiMessage.deleteMany({ where: { conversationId: id, conversation: owner } }),
	]);
}
