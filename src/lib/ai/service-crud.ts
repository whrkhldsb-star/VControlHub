/**
 * AI service — CRUD layer for AI providers and conversations.
 *
 * Extracted from the previous `lib/ai/service.ts` god-file as part of R28.
 * The runtime functions (model-fetching, chat-completion) live in
 * `./service-runtime`; DTO serializers in `./service-serialize`; this
 * module owns the prisma CRUD paths plus the input types.
 */
import type { AiAutomationMode } from "@prisma/client";
import { withHostedServerSnapshot } from "./hosted-snapshot";
import { isUniqueViolation, prisma } from "@/lib/db";
import { encrypt, decrypt, isEncrypted } from "@/lib/crypto/service";
import { BusinessError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { currentCopyLocale } from "@/lib/i18n/api-copy";
import { localizeSchemaMessage } from "@/lib/i18n/schema-copy";
import { seesAllCustomers, serverTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { verifiedBearerTokenId } from "@/lib/auth/bearer-token";
import { getApprovalPolicySettings } from "@/lib/command/approval-policy-settings";
import {
	DEFAULT_FULL_AUTO_TTL_MINUTES,
	MAX_FULL_AUTO_TTL_MINUTES,
	MODE_RANK,
	resolveEffectiveAutomationMode,
} from "./execution-mode";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { getAiConversationListLimit, getAiProviderListLimit } from "@/lib/runtime-settings/service";
import { normalizePublicHttpUrl } from "@/lib/storage/direct-access-url";
import { isLinkLocalAddress } from "@/lib/security/pinned-fetch";
import { aiProviderTypeSchema, providerModelIdSchema, providerModelListSchema, type AiProviderType } from "./schema";
import { checkProviderTransport, allowsKeylessProvider, resolveDefaultProviderBaseUrl, isListedPrivateProviderHost, providerApiRoot } from "./provider-http";

import { providerEndpointChanged, requiresExplicitDefaultModel } from "./provider-endpoint";

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
		checkProviderTransport(url);
		url.hash = "";
		return url.toString();
	}
	const normalized = normalizePublicHttpUrl(raw);
	checkProviderTransport(new URL(normalized));
	return normalized;
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
	expectedEndpoint?: { type: string; baseUrl: string };
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
	automationMode?: AiAutomationMode;
	automationModeTtlMinutes?: number;
	pinnedServerIds?: string[];
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
	automationMode?: AiAutomationMode;
	automationModeTtlMinutes?: number;
	pinnedServerIds?: string[];
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

function requireModelForProviderType(model: string | undefined, type: string, previousType?: string) {
	if (requiresExplicitDefaultModel(type, previousType) && !model?.trim()) {
		throw new ValidationError(localizeSchemaMessage("Missing model", currentCopyLocale() ?? "en"), { field: "defaultModel" });
	}
}

export async function createProvider(input: CreateProviderInput) {
	if (!input.name.trim()) throw new ValidationError(t("backend.ai.providerNameIsRequired"));

	const providerType = resolveProviderType(input.type);
	const normalizedBaseUrl = normalizeProviderBaseUrl(input.baseUrl, providerType);
	const normalizedModels = providerModelListSchema.parse(input.availableModels?.filter((model) => model.trim()) ?? []);
	requireModelForProviderType(input.defaultModel, providerType);
	const defaultModel = providerModelIdSchema.parse(input.defaultModel?.trim() || "gpt-4o");
	const key = input.apiKey.trim();
	if (!key && !allowsKeylessProvider(normalizedBaseUrl, providerType)) throw new ValidationError(t("backend.ai.apiKeyIsRequired"));
	const encryptedKey = key ? encrypt(key) : "";

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
				defaultModel,
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

async function upgradeStoredProviderKey<T extends { id: string; apiKey: string }>(row: T): Promise<T> {
	if (!row.apiKey || isEncrypted(row.apiKey)) return row;
	const apiKey = encrypt(row.apiKey);
	await prisma.aiProvider.updateMany({ where: { id: row.id, apiKey: row.apiKey }, data: { apiKey } });
	return { ...row, apiKey };
}

/** Upgrade dormant as well as active legacy rows when the AI worker starts. The CAS preserves a concurrent key rotation. */
export async function migrateLegacyProviderKeys() {
	let after: string | undefined;
	for (;;) {
		const rows: Array<{ id: string; apiKey: string }> = await prisma.aiProvider.findMany({
			where: { apiKey: { not: "" }, ...(after && { id: { gt: after } }) },
			select: { id: true, apiKey: true }, orderBy: { id: "asc" }, take: 50,
		});
		for (const row of rows) await upgradeStoredProviderKey(row);
		if (rows.length < 50) return;
		after = rows[rows.length - 1]!.id;
	}
}

export async function listChatProviders(userId: string) {
	return prisma.aiProvider.findMany({
		where: { createdBy: userId, enabled: true },
		orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
		take: await getAiProviderListLimit(),
		select: { id: true, name: true, type: true, defaultModel: true, availableModels: true, isDefault: true, enabled: true },
	});
}

export async function listProviders(userId: string) {
	const limit = await getAiProviderListLimit();
	const rows = await prisma.aiProvider.findMany({
		where: { createdBy: userId },
		orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
		take: limit,
		select: AI_PROVIDER_LIST_SELECT,
	});
	return Promise.all(rows.map(upgradeStoredProviderKey));
}

export async function getProviderById(id: string, userId: string) {
	const provider = await prisma.aiProvider.findFirst({
		where: { id, createdBy: userId },
		select: AI_PROVIDER_LIST_SELECT,
	});
	if (!provider) throw new NotFoundError(t("backend.ai.providerNotFound"));
	return upgradeStoredProviderKey(provider);
}

export async function updateProvider(id: string, userId: string, input: UpdateProviderInput) {
	const data: Record<string, unknown> = {};
	if (input.name !== undefined) {
		if (!input.name.trim()) throw new ValidationError(t("backend.ai.providerNameIsRequired"));
		data.name = input.name.trim();
	}
	const newType = input.type === undefined ? undefined : resolveProviderType(input.type);
	if (newType) data.type = newType;
	if (input.apiKey !== undefined) {
		const key = input.apiKey.trim();
		if (!key) throw new ValidationError(t("backend.ai.apiKeyIsRequired"));
		data.apiKey = encrypt(key);
	}
	// An empty model is not a choice: switching the provider type cleared it and
	// every new conversation then failed with 400 (A7-06).
	if (input.defaultModel?.trim()) data.defaultModel = providerModelIdSchema.parse(input.defaultModel);
	if (input.availableModels !== undefined) {
		data.availableModels = JSON.stringify(providerModelListSchema.parse(input.availableModels.filter((model) => model.trim())));
	}
	if (input.isDefault !== undefined) data.isDefault = input.isDefault;
	if (input.enabled !== undefined) data.enabled = input.enabled;
	if (input.settings !== undefined) data.settings = input.settings;

	if (!Object.keys(data).length && input.baseUrl === undefined) return getProviderById(id, userId);

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
				where: { id, createdBy: userId }, select: { type: true, baseUrl: true, apiKey: true },
			});
			if (!current) throw new NotFoundError(t("backend.ai.providerNotFound"));
			// A key-only edit carries the endpoint shown when the form opened.
			// A model discovery in another tab can safely refresh the list meanwhile.
			if (input.expectedEndpoint && (input.expectedEndpoint.type !== current.type || input.expectedEndpoint.baseUrl !== current.baseUrl)) {
				throw new ConflictError(t("backend.ai.providerKeyForNewEndpoint"));
			}
			const nextType = newType ?? current.type;
			requireModelForProviderType(input.defaultModel, nextType, current.type);
			const typeChanged = nextType !== current.type;
			const nextBaseUrl = normalizeProviderBaseUrl(input.baseUrl ?? (typeChanged ? undefined : current.baseUrl), nextType);
			if (!input.apiKey && (providerEndpointChanged(current, { type: nextType, baseUrl: nextBaseUrl }) || current.apiKey === "")) {
				if (!allowsKeylessProvider(nextBaseUrl, nextType)) throw new ValidationError(t("backend.ai.providerKeyForNewEndpoint"));
				data.apiKey = "";
			}
			data.baseUrl = nextBaseUrl;
			endpointGuard = { type: current.type, baseUrl: current.baseUrl, apiKey: current.apiKey };
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

async function validatePinnedServerIds(rawIds: string[] | undefined, session: TeamSession): Promise<string[] | undefined> {
	if (rawIds === undefined) return undefined;
	const uniqueIds = Array.from(new Set(rawIds.map((id) => id.trim()).filter(Boolean)));
	if (uniqueIds.length === 0) return [];
	const visible = await prisma.server.findMany({
		where: { id: { in: uniqueIds }, enabled: true, AND: [serverTeamWhere(session, "connect")] },
		select: { id: true },
	});
	if (visible.length !== uniqueIds.length) {
		throw new ValidationError(t("backend.command.targetsOutOfScope"));
	}
	return uniqueIds;
}

async function assertRequestedAutomationModeAllowed(
	mode: AiAutomationMode,
	session: TeamSession,
	ttlMinutes?: number,
): Promise<{ mode: AiAutomationMode; expiresAt: Date | null }> {
	if (mode === "PLAN_ONLY" || mode === "ASSISTED") {
		return { mode, expiresAt: null };
	}
	const viaToken = Boolean(verifiedBearerTokenId(session));
	const policies = await getApprovalPolicySettings({ fresh: true });
	const resolved = resolveEffectiveAutomationMode({
		requestedMode: mode,
		policies,
		session,
		viaToken,
	});
	if (MODE_RANK[resolved.effectiveMode] < MODE_RANK[mode]) {
		const permission = mode === "FULL_AUTO" ? "ai:action:full-auto" : "ai:action:auto";
		throw new ForbiddenError(t("backend.ai.permissionDenied.required", { permission }));
	}
	if (mode === "FULL_AUTO") {
		const clampedMinutes = Math.max(5, Math.min(ttlMinutes ?? DEFAULT_FULL_AUTO_TTL_MINUTES, MAX_FULL_AUTO_TTL_MINUTES));
		return { mode, expiresAt: new Date(Date.now() + clampedMinutes * 60_000) };
	}
	return { mode, expiresAt: null };
}

export async function createConversation(input: CreateConversationInput, session: TeamSession) {
	const owner = conversationOwnerWhere(session);
	// Ownership gate: never allow binding another user's provider (IDOR + secret exposure).
	const provider = await prisma.aiProvider.findFirst({
		where: { id: input.providerId, createdBy: session.userId },
	});
	if (!provider) throw new NotFoundError(t("backend.ai.aiProviderNotFound"));

	const modeResolution = await assertRequestedAutomationModeAllowed(
		input.automationMode ?? "ASSISTED",
		session,
		input.automationModeTtlMinutes,
	);
	const pinnedServerIds = await validatePinnedServerIds(input.pinnedServerIds, session);

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
			automationMode: modeResolution.mode,
			...(modeResolution.expiresAt !== null ? { automationModeExpiresAt: modeResolution.expiresAt } : {}),
			...(pinnedServerIds !== undefined ? { pinnedServerIds } : {}),
			...owner,
		},
		// Never include provider.apiKey ciphertext on conversation create responses.
		include: {
			provider: { select: { id: true, name: true, type: true } },
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

export async function getConversationById(id: string, session: TeamSession, before?: { createdAt: Date; id: string }) {
	// Cap message payload size for long threads (chat path loads conversation often).
	const MESSAGE_TAKE = 500;
	const conv = await prisma.aiConversation.findFirst({
		where: { id, ...conversationOwnerWhere(session) },
		include: {
			// Exclude apiKey ciphertext from API-facing conversation payloads.
			provider: { select: { id: true, name: true, type: true } },
			// Latest window first, then reverse to chronological for UI. The id
			// orders turns written within one millisecond (an assistant turn and
			// its tool results): by createdAt alone a result could precede its
			// call, be dropped from the history, and leave the call unanswered.
			messages: {
				...(before && { where: { OR: [{ createdAt: { lt: before.createdAt } }, { createdAt: before.createdAt, id: { lt: before.id } }] } }),
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
							effectiveRisk: true,
							riskReasons: true,
							decisionSource: true,
							modeAtDecision: true,
							commandRequestId: true,
							autoApproved: true,
							result: true,
							errorMessage: true,
							createdAt: true,
							approvedAt: true,
							executedAt: true,
							completedAt: true,
						},
					},
				},
			},
		},
	});
	if (!conv) throw new NotFoundError(t("backend.ai.conversationNotFound"));
	return { ...conv, messages: conv.messages.reverse().map((message) => ({ ...message, hostedActions: message.hostedActions.map(withHostedServerSnapshot) })) };
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
	if (input.automationMode !== undefined) {
		const resolved = await assertRequestedAutomationModeAllowed(
			input.automationMode,
			session,
			input.automationModeTtlMinutes,
		);
		data.automationMode = resolved.mode;
		data.automationModeExpiresAt = resolved.expiresAt;
	}
	if (input.pinnedServerIds !== undefined) {
		data.pinnedServerIds = await validatePinnedServerIds(input.pinnedServerIds, session);
	}

	const owner = conversationOwnerWhere(session);
	return prisma.$transaction(async (tx) => {
		const [row] = await tx.$queryRaw<Array<{ updatedAt: Date }>>`SELECT "updatedAt" FROM ai_conversations
			WHERE id = ${id} AND "createdBy" = ${owner.createdBy} AND "teamId" IS NOT DISTINCT FROM ${owner.teamId} FOR UPDATE`;
		if (!row) throw new NotFoundError(t("backend.ai.conversationNotFound"));
		return tx.aiConversation.update({
			where: { id, ...owner }, data: { ...data, updatedAt: new Date(Math.max(Date.now(), row.updatedAt.getTime() + 1)) },
			include: { provider: { select: { id: true, name: true, type: true } } },
		});
	});
}

export async function deleteConversation(id: string, session: TeamSession) {
	// The database cascades the same scoped deletion to messages and action cards.
	const deleted = await prisma.aiConversation.deleteMany({ where: { id, ...conversationOwnerWhere(session) } });
	if (!deleted.count) throw new NotFoundError(t("backend.ai.conversationNotFound"));
}

export async function clearConversationMessages(id: string, session: TeamSession) {
	const owner = conversationOwnerWhere(session);
	await prisma.$transaction(async (tx) => {
		const advanced = await tx.$executeRaw`UPDATE ai_conversations
			SET "updatedAt" = GREATEST((clock_timestamp() AT TIME ZONE 'UTC'), "updatedAt" + interval '1 millisecond')
			WHERE id = ${id} AND "createdBy" = ${owner.createdBy} AND "teamId" IS NOT DISTINCT FROM ${owner.teamId}`;
		if (!advanced) throw new NotFoundError(t("backend.ai.conversationNotFound"));
		await tx.aiMessage.deleteMany({ where: { conversationId: id } });
	});
}
