/**
 * AI service — DTO serializers.
 *
 * Extracted from `lib/ai/service.ts` as part of R28 god-file split.
 * Lives next to `service-crud` (owns the read queries) and
 * `service-runtime` (owns the chat-completion / model-fetch paths).
 */
import { isChatImageUrl } from "./chat-message-payload";
import type { createProvider, getConversationById, listConversations } from "./service-crud";

/* ── Serialization ──────────────────────────────────────────── */

export function serializeProvider(p: Awaited<ReturnType<typeof createProvider>>) {
	return {
		...p,
		apiKey: p.apiKey ? "••••••••" : "",
		createdAt: p.createdAt.toISOString(),
		updatedAt: p.updatedAt.toISOString(),
	};
}

function storedImages(raw: string) {
	try {
		const urls: unknown = JSON.parse(raw);
		const safe = Array.isArray(urls) ? urls.filter(isChatImageUrl) : [];
		return { imageUrls: JSON.stringify(safe), removed: Array.isArray(urls) && urls.length !== safe.length };
	} catch {
		return { imageUrls: "[]", removed: false };
	}
}

export function serializeConversation(c: Awaited<ReturnType<typeof getConversationById>>) {
	return {
		...c,
		automationModeExpiresAt: c.automationModeExpiresAt?.toISOString() ?? null,
		pinnedServerIds: c.pinnedServerIds ?? [],
		createdAt: c.createdAt.toISOString(),
		updatedAt: c.updatedAt.toISOString(),
		messages: c.messages.map((m) => {
			const { imageUrls, removed } = storedImages(m.imageUrls);
			return {
				...m,
				imageUrls,
				...(m.role === "user" && removed && { requiresLocalFiles: true }),
				createdAt: m.createdAt.toISOString(),
				hostedActions: m.hostedActions.map((action) => ({
					...action,
					createdAt: action.createdAt.toISOString(),
					approvedAt: action.approvedAt?.toISOString() ?? null,
					executedAt: action.executedAt?.toISOString() ?? null,
					completedAt: action.completedAt?.toISOString() ?? null,
				})),
			};
		}),
	};
}

export function serializeConversationListItem(
	c: Awaited<ReturnType<typeof listConversations>>[number]
) {
	return {
		...c,
		automationModeExpiresAt: c.automationModeExpiresAt?.toISOString() ?? null,
		pinnedServerIds: c.pinnedServerIds ?? [],
		createdAt: c.createdAt.toISOString(),
		updatedAt: c.updatedAt.toISOString(),
	};
}
